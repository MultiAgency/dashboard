import { and, eq, inArray, or } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Engagement, engagementProjects, engagements, prepayments } from "../db/schema";
import { type OrgScope, sharedViewScope } from "../lib/agency-scope";
import type { OrganizationAccess, Organizations } from "../lib/organization-access";
import type { ProjectDirectory } from "./project-directory";

export type EngagementRole = "agency" | "client";

export type EngagementView = {
  id: string;
  kind: Engagement["kind"];
  status: Engagement["status"];
  role: EngagementRole;
  agency: { organizationId: string; name: string };
  agencyHasTreasury: boolean;
  client: { organizationId: string; name: string };
  projectIds: string[];
  createdAt: Date;
  endedAt: Date | null;
};

const notFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const alreadyActive = () =>
  new ORPCError("CONFLICT", {
    message: "There is already an active Engagement of this kind between these Organizations.",
  });

export function createEngagementsService(
  db: Database,
  directory: ProjectDirectory,
  organizations: Organizations,
  access: OrganizationAccess,
) {
  const projectIdsOf = async (ids: string[]) => {
    const byEngagement = new Map<string, string[]>();
    if (ids.length === 0) return byEngagement;
    const rows = await db
      .select()
      .from(engagementProjects)
      .where(inArray(engagementProjects.engagementId, ids));
    for (const row of rows) {
      const list = byEngagement.get(row.engagementId) ?? [];
      list.push(row.projectId);
      byEngagement.set(row.engagementId, list);
    }
    return byEngagement;
  };

  const view = (
    row: Engagement,
    organizationId: string,
    projectIds: string[],
    agencyHasTreasury: boolean,
  ): EngagementView => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    role: row.agencyOrganizationId === organizationId ? "agency" : "client",
    agency: { organizationId: row.agencyOrganizationId, name: row.agencyName },
    agencyHasTreasury,
    client: { organizationId: row.clientOrganizationId, name: row.clientName },
    projectIds,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  });

  const viewOne = async (row: Engagement, organizationId: string) =>
    view(
      row,
      organizationId,
      (await projectIdsOf([row.id])).get(row.id) ?? [],
      (await access.daoOf(row.agencyOrganizationId)) !== null,
    );

  const findAs = (scope: OrgScope, id: string, side: EngagementRole) =>
    Effect.gen(function* () {
      const column =
        side === "agency" ? engagements.agencyOrganizationId : engagements.clientOrganizationId;
      const [row] = yield* Effect.promise(() =>
        db
          .select()
          .from(engagements)
          .where(and(eq(engagements.id, id), eq(column, scope.organizationId)))
          .limit(1),
      );
      if (!row) return yield* Effect.fail(notFound());
      return row;
    });

  const update = (id: string, patch: Partial<Engagement>) =>
    Effect.tryPromise({
      try: () =>
        db
          .update(engagements)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(engagements.id, id))
          .returning()
          .then((rows) => rows[0]!),
      catch: (error) => (isUniqueViolation(error) ? alreadyActive() : error),
    });

  const insert = (values: typeof engagements.$inferInsert) =>
    Effect.tryPromise({
      try: () =>
        db
          .insert(engagements)
          .values(values)
          .returning()
          .then((rows) => rows[0]!),
      catch: (error) => (isUniqueViolation(error) ? alreadyActive() : error),
    });

  const requireActiveFree = (agencyOrganizationId: string, clientOrganizationId: string) =>
    Effect.gen(function* () {
      if (agencyOrganizationId === clientOrganizationId) {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", { message: "An Organization cannot engage itself." }),
        );
      }
      const [existing] = yield* Effect.promise(() =>
        db
          .select({ id: engagements.id })
          .from(engagements)
          .where(
            and(
              eq(engagements.agencyOrganizationId, agencyOrganizationId),
              eq(engagements.clientOrganizationId, clientOrganizationId),
              inArray(engagements.status, ["active", "proposed"]),
            ),
          )
          .limit(1),
      );
      if (existing) return yield* Effect.fail(alreadyActive());
    });

  const nameOf = (scope: OrgScope, organizationId: string) =>
    Effect.promise(async () => {
      const fromContext = scope.pluginContext.organization?.organization;
      if (fromContext?.id === organizationId && fromContext.name) return fromContext.name;
      return (await organizations.nameOf(scope.pluginContext, organizationId)) ?? "";
    });

  return {
    list: (scope: OrgScope) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() => access.engagements(scope));
        const projectIds = yield* Effect.promise(() => projectIdsOf(rows.map((r) => r.id)));
        const data = yield* Effect.promise(() =>
          Promise.all(
            rows.map(
              async (row): Promise<EngagementView> => ({
                id: row.id,
                kind: row.kind,
                status: row.status,
                role: row.role,
                agency: { organizationId: row.agencyOrganizationId, name: row.agencyName },
                agencyHasTreasury: (await access.daoOf(row.agencyOrganizationId)) !== null,
                client: { organizationId: row.clientOrganizationId, name: row.clientName },
                projectIds: projectIds.get(row.id) ?? [],
                createdAt: row.createdAt,
                endedAt: row.endedAt,
              }),
            ),
          ),
        );
        data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { data };
      }),

    propose: (scope: OrgScope, input: { clientOrganizationId: string }) =>
      Effect.gen(function* () {
        const clientOrganizationId = input.clientOrganizationId.trim();
        yield* requireActiveFree(scope.organizationId, clientOrganizationId);
        const row = yield* insert({
          id: crypto.randomUUID(),
          agencyOrganizationId: scope.organizationId,
          agencyName: yield* nameOf(scope, scope.organizationId),
          clientOrganizationId,
          status: "proposed",
          createdBy: scope.actorId,
        });
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),

    accept: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, id, "client");
        if (row.status !== "proposed") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Only proposed Engagements can be accepted." }),
          );
        }
        const updated = yield* update(id, {
          status: "active",
          clientName: yield* nameOf(scope, scope.organizationId),
        });
        return yield* Effect.promise(() => viewOne(updated, scope.organizationId));
      }),

    decline: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, id, "client");
        if (row.status !== "proposed") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Only proposed Engagements can be declined." }),
          );
        }
        const updated = yield* update(id, { status: "declined" });
        return yield* Effect.promise(() => viewOne(updated, scope.organizationId));
      }),

    end: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, id, "agency");
        if (row.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Only active Engagements can be ended." }),
          );
        }
        const updated = yield* update(id, { status: "ended", endedAt: new Date() });
        return yield* Effect.promise(() => viewOne(updated, scope.organizationId));
      }),

    share: (scope: OrgScope, input: { engagementId: string; projectId: string }) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, input.engagementId, "agency");
        if (row.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Projects can only be shared through an active Engagement.",
            }),
          );
        }
        yield* Effect.promise(() => directory.forAgency(scope).require(input.projectId));
        yield* Effect.promise(() =>
          db
            .insert(engagementProjects)
            .values({ engagementId: row.id, projectId: input.projectId })
            .onConflictDoNothing(),
        );
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),

    unshare: (scope: OrgScope, input: { engagementId: string; projectId: string }) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, input.engagementId, "agency");
        yield* Effect.promise(() =>
          db
            .delete(engagementProjects)
            .where(
              and(
                eq(engagementProjects.engagementId, row.id),
                eq(engagementProjects.projectId, input.projectId),
              ),
            ),
        );
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),

    asParty: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db
            .select()
            .from(engagements)
            .where(
              and(
                eq(engagements.id, id),
                or(
                  eq(engagements.agencyOrganizationId, scope.organizationId),
                  eq(engagements.clientOrganizationId, scope.organizationId),
                ),
              ),
            )
            .limit(1),
        );
        if (!row) return yield* Effect.fail(notFound());
        return row;
      }),

    forParty: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db
            .select()
            .from(engagements)
            .where(
              and(
                eq(engagements.id, id),
                or(
                  eq(engagements.agencyOrganizationId, scope.organizationId),
                  eq(engagements.clientOrganizationId, scope.organizationId),
                ),
              ),
            )
            .limit(1),
        );
        if (!row || (row.status !== "active" && row.status !== "ended")) {
          return yield* Effect.fail(notFound());
        }
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),

    asAgency: (scope: OrgScope, id: string) => findAs(scope, id, "agency"),

    subcontract: (
      scope: OrgScope,
      input: {
        subcontractorOrganizationId: string;
        projectIds?: string[];
        prepayment?: {
          tokenId: string;
          amount: string;
          periodStart: string;
          periodEnd: string;
          transferReference?: string;
        };
      },
    ) =>
      Effect.gen(function* () {
        const subcontractor = input.subcontractorOrganizationId.trim();
        if (subcontractor === scope.organizationId) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "An Organization cannot engage itself." }),
          );
        }
        const prepayment = input.prepayment;
        if (prepayment && !scope.agencyDao) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Connect a treasury before recording a Prepayment.",
            }),
          );
        }
        if (prepayment && prepayment.periodStart > prepayment.periodEnd) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "periodStart must be on or before periodEnd",
            }),
          );
        }
        for (const projectId of new Set(input.projectIds ?? [])) {
          yield* Effect.promise(() => directory.forAgency(scope).require(projectId));
        }
        const [existing] = yield* Effect.promise(() =>
          db
            .select()
            .from(engagements)
            .where(
              and(
                eq(engagements.agencyOrganizationId, scope.organizationId),
                eq(engagements.clientOrganizationId, subcontractor),
                eq(engagements.kind, "subcontract"),
                eq(engagements.status, "active"),
              ),
            )
            .limit(1),
        );
        const row =
          existing ??
          (yield* insert({
            id: crypto.randomUUID(),
            agencyOrganizationId: scope.organizationId,
            agencyName: yield* nameOf(scope, scope.organizationId),
            clientOrganizationId: subcontractor,
            clientName:
              (yield* Effect.promise(() =>
                organizations.nameOf(scope.pluginContext, subcontractor),
              )) ?? "",
            kind: "subcontract",
            status: "active",
            createdBy: scope.actorId,
          }));
        const projectIds = [...new Set(input.projectIds ?? [])];
        if (projectIds.length > 0) {
          yield* Effect.promise(() =>
            db
              .insert(engagementProjects)
              .values(projectIds.map((projectId) => ({ engagementId: row.id, projectId })))
              .onConflictDoNothing(),
          );
        }
        if (prepayment) {
          yield* Effect.promise(() =>
            db.insert(prepayments).values({
              id: crypto.randomUUID(),
              engagementId: row.id,
              tokenId: prepayment.tokenId,
              amount: prepayment.amount,
              periodStart: prepayment.periodStart,
              periodEnd: prepayment.periodEnd,
              transferReference: prepayment.transferReference?.trim() || null,
              actorAccountId: scope.actorId,
            }),
          );
        }
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),

    subcontractedProjects: (scope: OrgScope) =>
      Effect.promise(async () => {
        const rows = await db
          .select({
            engagementId: engagements.id,
            agencyOrganizationId: engagements.agencyOrganizationId,
            projectId: engagementProjects.projectId,
          })
          .from(engagementProjects)
          .innerJoin(engagements, eq(engagements.id, engagementProjects.engagementId))
          .where(
            and(
              eq(engagements.clientOrganizationId, scope.organizationId),
              eq(engagements.kind, "subcontract"),
              eq(engagements.status, "active"),
            ),
          );
        return rows;
      }),

    workOn: (scope: OrgScope, projectId: string) =>
      Effect.promise(async (): Promise<"owned" | "subcontracted"> => {
        const relation = await access.projectAccess(scope, projectId);
        if (relation === "owned") return "owned";
        if (relation === "subcontractor") return "subcontracted";
        throw new ORPCError("NOT_FOUND", { message: "Project not found" });
      }),

    subcontractedProjectDetails: (scope: OrgScope) =>
      Effect.promise(async () => {
        const rows = await db
          .select({
            agencyOrganizationId: engagements.agencyOrganizationId,
            projectId: engagementProjects.projectId,
          })
          .from(engagementProjects)
          .innerJoin(engagements, eq(engagements.id, engagementProjects.engagementId))
          .where(
            and(
              eq(engagements.clientOrganizationId, scope.organizationId),
              eq(engagements.kind, "subcontract"),
              eq(engagements.status, "active"),
            ),
          );
        const byAgency = new Map<string, Set<string>>();
        for (const row of rows) {
          const ids = byAgency.get(row.agencyOrganizationId) ?? new Set<string>();
          ids.add(row.projectId);
          byAgency.set(row.agencyOrganizationId, ids);
        }
        const out = [];
        for (const [agencyOrganizationId, ids] of byAgency) {
          const dao = await organizations.daoOf(agencyOrganizationId);
          const view = sharedViewScope(scope, agencyOrganizationId, dao);
          const projects = await directory.forAgency(view).list();
          out.push(...projects.filter((p) => ids.has(p.id)));
        }
        return out;
      }),

    asClient: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const row = yield* findAs(scope, id, "client");
        if (row.status !== "active" && row.status !== "ended") {
          return yield* Effect.fail(notFound());
        }
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
      }),
  };
}

export type EngagementsService = ReturnType<typeof createEngagementsService>;
