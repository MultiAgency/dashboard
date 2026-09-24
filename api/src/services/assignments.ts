import { and, desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";
import type { AgencyScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";

export function createAssignmentsService(db: Database, directory: ProjectDirectory) {
  return {
    list: (scope: AgencyScope, projectId: string) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => directory.forAgency(scope).require(projectId));
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(eq(projectContributors.projectId, projectId))
            .orderBy(desc(projectContributors.createdAt)),
        );
        return {
          data: rows.map((r) => ({
            projectId: r.projectId,
            nearAccount: r.nearAccount,
            role: r.role,
            onboardingStatus: r.onboardingStatus,
            createdAt: r.createdAt,
          })),
        };
      }),

    listAll: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const [rows, projects] = yield* Effect.promise(() =>
          Promise.all([
            db.select().from(projectContributors).orderBy(desc(projectContributors.createdAt)),
            directory.forAgency(scope).list(),
          ]),
        );
        const projectById = new Map(projects.map((p) => [p.id, p]));
        return {
          data: rows.flatMap((r) => {
            const project = projectById.get(r.projectId);
            if (!project) return [];
            return [
              {
                projectId: r.projectId,
                projectSlug: project.slug,
                projectTitle: project.title,
                nearAccount: r.nearAccount,
                role: r.role,
                onboardingStatus: r.onboardingStatus,
                createdAt: r.createdAt,
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
        const project = yield* Effect.promise(() =>
          directory.forAgency(scope).require(input.projectId),
        );
        const organizationId = project.organizationId || scope.organizationId;
        if (!input.nearAccount?.trim()) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "nearAccount is required" }),
          );
        }

        yield* Effect.promise(() =>
          db
            .insert(projectContributors)
            .values({
              projectId: input.projectId,
              nearAccount: input.nearAccount.trim(),
              role: input.role ?? null,
              onboardingStatus: input.onboardingStatus ?? "pending",
              organizationId,
            })
            .onConflictDoUpdate({
              target: [projectContributors.projectId, projectContributors.nearAccount],
              set: {
                role: input.role ?? null,
                organizationId,
                ...(input.onboardingStatus !== undefined
                  ? { onboardingStatus: input.onboardingStatus }
                  : {}),
              },
            }),
        );

        return {
          projectId: input.projectId,
          nearAccount: input.nearAccount.trim(),
          role: input.role ?? null,
          onboardingStatus: input.onboardingStatus ?? "pending",
        };
      }),

    delete: (scope: AgencyScope, input: { projectId: string; nearAccount: string }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => directory.forAgency(scope).require(input.projectId));
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
