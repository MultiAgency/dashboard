import { and, eq, inArray, or } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Engagement, engagementProjects, engagements } from "../db/schema";
import type { OrgScope } from "../lib/agency-scope";
import type { Organizations } from "../lib/organization-access";
import type { ProjectDirectory } from "./project-directory";

export type EngagementRole = "agency" | "client";

export type EngagementView = {
  id: string;
  kind: Engagement["kind"];
  status: Engagement["status"];
  role: EngagementRole;
  agency: { organizationId: string; name: string };
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
    message: "There is already an active Engagement between these Organizations.",
  });

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "client"}-${crypto.randomUUID().slice(0, 6)}`;
}

export function createEngagementsService(
  db: Database,
  directory: ProjectDirectory,
  organizations: Organizations,
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

  const view = (row: Engagement, organizationId: string, projectIds: string[]): EngagementView => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    role: row.agencyOrganizationId === organizationId ? "agency" : "client",
    agency: { organizationId: row.agencyOrganizationId, name: row.agencyName },
    client: { organizationId: row.clientOrganizationId, name: row.clientName },
    projectIds,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  });

  const viewOne = async (row: Engagement, organizationId: string) =>
    view(row, organizationId, (await projectIdsOf([row.id])).get(row.id) ?? []);

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
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(engagements)
            .where(
              or(
                eq(engagements.agencyOrganizationId, scope.organizationId),
                eq(engagements.clientOrganizationId, scope.organizationId),
              ),
            ),
        );
        const projectIds = yield* Effect.promise(() => projectIdsOf(rows.map((r) => r.id)));
        const data = rows
          .map((row) => view(row, scope.organizationId, projectIds.get(row.id) ?? []))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { data };
      }),

    createClient: (scope: OrgScope, input: { name: string; adminEmail: string }) =>
      Effect.gen(function* () {
        const name = input.name.trim();
        const created = yield* Effect.promise(() =>
          organizations.create(scope.pluginContext, { name, slug: slugify(name) }),
        );
        yield* Effect.promise(() =>
          organizations.invite(scope.pluginContext, {
            organizationId: created.id,
            email: input.adminEmail.trim().toLowerCase(),
            role: "owner",
          }),
        );
        const row = yield* insert({
          id: crypto.randomUUID(),
          agencyOrganizationId: scope.organizationId,
          agencyName: yield* nameOf(scope, scope.organizationId),
          clientOrganizationId: created.id,
          clientName: name,
          status: "active",
          createdBy: scope.actorId,
        });
        return yield* Effect.promise(() => viewOne(row, scope.organizationId));
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
