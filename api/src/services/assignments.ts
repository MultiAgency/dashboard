import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import {
  type AgencyScope,
  type OrganizationAccessService,
  type WorkableProject,
  workable,
} from "./organization-access";
import type { Project, ProjectDirectory } from "./project-directory";

type AssignmentRow = typeof projectContributors.$inferSelect;

function assignerOf(row: AssignmentRow): string | null {
  return row.assignedByOrganizationId ?? row.organizationId;
}

export function createAssignmentsService(
  db: Database,
  directory: ProjectDirectory,
  access: Pick<OrganizationAccessService, "workableProject" | "subcontractedProjects">,
  organizations: Pick<OrganizationDirectory, "get">,
) {
  const findRow = (projectId: string, nearAccount: string) =>
    Effect.promise(async () => {
      const [row] = await db
        .select()
        .from(projectContributors)
        .where(
          and(
            eq(projectContributors.projectId, projectId),
            eq(projectContributors.nearAccount, nearAccount),
          ),
        )
        .limit(1);
      return row ?? null;
    });

  async function assigners(rows: AssignmentRow[]) {
    const ids = [...new Set(rows.flatMap((r) => assignerOf(r) ?? []))];
    const found = await Promise.all(ids.map((id) => organizations.get(id)));
    return new Map(ids.map((id, i) => [id, { id, name: found[i]?.name ?? id }]));
  }

  function view(
    scope: AgencyScope,
    row: AssignmentRow,
    names: Map<string, { id: string; name: string }>,
  ) {
    const assigner = assignerOf(row);
    return {
      projectId: row.projectId,
      nearAccount: row.nearAccount,
      role: row.role,
      onboardingStatus: row.onboardingStatus,
      assignedBy: assigner ? (names.get(assigner) ?? { id: assigner, name: assigner }) : null,
      canRemove: assigner !== null && assigner === scope.organizationId,
      createdAt: row.createdAt,
    };
  }

  const refuseOthers = (scope: AgencyScope, row: AssignmentRow | null, target: WorkableProject) =>
    row && (assignerOf(row) ?? target.project.organizationId) !== scope.organizationId;

  return {
    list: (scope: AgencyScope, projectId: string) =>
      Effect.gen(function* () {
        yield* workable(access, scope, projectId);
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(eq(projectContributors.projectId, projectId))
            .orderBy(desc(projectContributors.createdAt)),
        );
        const names = yield* Effect.promise(() => assigners(rows));
        return { data: rows.map((r) => view(scope, r, names)) };
      }),

    listAll: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const [owned, shared] = yield* Effect.promise(() =>
          Promise.all([directory.forAgency(scope).list(), access.subcontractedProjects(scope)]),
        );
        const projectById = new Map<string, Project>(
          [...owned, ...shared.map((s) => s.project)].map((p) => [p.id, p]),
        );
        if (projectById.size === 0) return { data: [] };
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(inArray(projectContributors.projectId, [...projectById.keys()]))
            .orderBy(desc(projectContributors.createdAt)),
        );
        const names = yield* Effect.promise(() => assigners(rows));
        return {
          data: rows.flatMap((r) => {
            const project = projectById.get(r.projectId);
            if (!project) return [];
            return [
              {
                ...view(scope, r, names),
                projectSlug: project.slug,
                projectTitle: project.title,
              },
            ];
          }),
        };
      }),

    create: (
      scope: AgencyScope,
      input: {
        projectId: string;
        nearAccount: string;
        role?: string;
        onboardingStatus?: string;
      },
    ) =>
      Effect.gen(function* () {
        const target = yield* workable(access, scope, input.projectId, true);
        const nearAccount = input.nearAccount?.trim();
        if (!nearAccount) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "nearAccount is required" }),
          );
        }
        const existing = yield* findRow(input.projectId, nearAccount);
        if (refuseOthers(scope, existing, target)) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: `${nearAccount} is already assigned to this Project by another Organization.`,
              data: { reason: "ASSIGNED_BY_OTHER" },
            }),
          );
        }
        const organizationId = target.project.organizationId || scope.organizationId;
        const assignedByOrganizationId = scope.organizationId;

        yield* Effect.promise(() =>
          db
            .insert(projectContributors)
            .values({
              projectId: input.projectId,
              nearAccount,
              role: input.role ?? null,
              onboardingStatus: input.onboardingStatus ?? "pending",
              organizationId,
              assignedByOrganizationId,
            })
            .onConflictDoUpdate({
              target: [projectContributors.projectId, projectContributors.nearAccount],
              set: {
                role: input.role ?? null,
                organizationId,
                assignedByOrganizationId,
                ...(input.onboardingStatus !== undefined
                  ? { onboardingStatus: input.onboardingStatus }
                  : {}),
              },
            }),
        );

        return {
          projectId: input.projectId,
          nearAccount,
          role: input.role ?? null,
          onboardingStatus: input.onboardingStatus ?? "pending",
        };
      }),

    delete: (scope: AgencyScope, input: { projectId: string; nearAccount: string }) =>
      Effect.gen(function* () {
        const target = yield* workable(access, scope, input.projectId, true);
        const existing = yield* findRow(input.projectId, input.nearAccount);
        if (refuseOthers(scope, existing, target)) {
          return yield* Effect.fail(
            new ORPCError("FORBIDDEN", {
              message: "Only the Organization that assigned this builder can remove them.",
              data: { reason: "ASSIGNED_BY_OTHER" },
            }),
          );
        }
        yield* Effect.promise(() =>
          db
            .delete(projectContributors)
            .where(
              and(
                eq(projectContributors.projectId, input.projectId),
                eq(projectContributors.nearAccount, input.nearAccount),
              ),
            ),
        );
        return { ok: true as const };
      }),
  };
}

export type AssignmentsService = ReturnType<typeof createAssignmentsService>;
