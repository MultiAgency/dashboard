import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Client, clientProjects, clients } from "../db/schema";
import type { AgencyScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";

const clientNotFound = () => new ORPCError("NOT_FOUND", { message: "Client not found" });

export function createClientsService(db: Database, directory: ProjectDirectory) {
  const requireClient = (scope: AgencyScope, id: string) =>
    Effect.gen(function* () {
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(clients)
          .where(and(eq(clients.id, id), eq(clients.agencyDaoAccountId, scope.agencyDao)))
          .limit(1),
      );
      const row = rows[0];
      if (!row) return yield* Effect.fail(clientNotFound());
      return row;
    });

  const requireAgencyProjects = (scope: AgencyScope, projectIds: string[] | undefined) =>
    Effect.promise(async () => {
      const projects = directory.forAgency(scope);
      for (const projectId of new Set(projectIds ?? [])) await projects.require(projectId);
    });

  const projectIdsOf = (clientId: string) =>
    Effect.promise(() =>
      db
        .select({ projectId: clientProjects.projectId })
        .from(clientProjects)
        .where(eq(clientProjects.clientId, clientId))
        .then((rows) => rows.map((r) => r.projectId)),
    );

  return {
    list: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const rows: Client[] = yield* Effect.promise(() =>
          db
            .select()
            .from(clients)
            .where(eq(clients.agencyDaoAccountId, scope.agencyDao))
            .orderBy(desc(clients.updatedAt)),
        );
        if (rows.length === 0) return { data: [] as Array<Client & { projectIds: string[] }> };

        const clientIds = rows.map((r) => r.id);
        const projectRows = yield* Effect.promise(() =>
          db.select().from(clientProjects).where(inArray(clientProjects.clientId, clientIds)),
        );
        const projectsByClient = new Map<string, string[]>();
        for (const row of projectRows) {
          const list = projectsByClient.get(row.clientId) ?? [];
          list.push(row.projectId);
          projectsByClient.set(row.clientId, list);
        }

        return {
          data: rows.map((row) => ({
            ...row,
            projectIds: projectsByClient.get(row.id) ?? [],
          })),
        };
      }),

    get: (scope: AgencyScope, id: string) =>
      Effect.gen(function* () {
        const row = yield* requireClient(scope, id);
        return { client: row, projectIds: yield* projectIdsOf(id) };
      }),

    projectIdsFor: (scope: AgencyScope, clientId: string) =>
      Effect.gen(function* () {
        yield* requireClient(scope, clientId);
        return yield* projectIdsOf(clientId);
      }),

    create: (
      scope: AgencyScope,
      input: {
        orgId: string;
        name: string;
        nearAccountId?: string;
        projectIds?: string[];
      },
    ) =>
      Effect.gen(function* () {
        yield* requireAgencyProjects(scope, input.projectIds);

        const near = input.nearAccountId?.trim() || null;
        if (near) {
          const dup = yield* Effect.promise(() =>
            db
              .select({ id: clients.id })
              .from(clients)
              .where(
                and(
                  eq(clients.nearAccountId, near),
                  eq(clients.agencyDaoAccountId, scope.agencyDao),
                ),
              )
              .limit(1),
          );
          if (dup[0]) {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", {
                message: "This NEAR account is already a client of this agency.",
              }),
            );
          }
        }

        const id = crypto.randomUUID();
        const now = new Date();

        const [row] = yield* Effect.promise(() =>
          db
            .insert(clients)
            .values({
              id,
              orgId: input.orgId,
              agencyDaoAccountId: scope.agencyDao,
              name: input.name.trim(),
              nearAccountId: near,
              createdAt: now,
              updatedAt: now,
            })
            .returning(),
        );
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" }),
          );
        }

        if (input.projectIds?.length) {
          yield* Effect.promise(() =>
            db.insert(clientProjects).values(
              [...new Set(input.projectIds)].map((projectId) => ({
                clientId: id,
                projectId,
                createdAt: now,
              })),
            ),
          );
        }

        return { client: row, projectIds: yield* projectIdsOf(id) };
      }),

    update: (
      scope: AgencyScope,
      input: {
        id: string;
        name?: string;
        nearAccountId?: string | null;
        projectIds?: string[];
      },
    ) =>
      Effect.gen(function* () {
        yield* requireClient(scope, input.id);
        yield* requireAgencyProjects(scope, input.projectIds);

        const updates: Partial<Client> = { updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name.trim();
        if (input.nearAccountId !== undefined) updates.nearAccountId = input.nearAccountId;

        const [row] = yield* Effect.promise(() =>
          db.update(clients).set(updates).where(eq(clients.id, input.id)).returning(),
        );

        if (input.projectIds !== undefined) {
          yield* Effect.promise(() =>
            db.delete(clientProjects).where(eq(clientProjects.clientId, input.id)),
          );
          if (input.projectIds.length > 0) {
            const now = new Date();
            yield* Effect.promise(() =>
              db.insert(clientProjects).values(
                [...new Set(input.projectIds)].map((projectId) => ({
                  clientId: input.id,
                  projectId,
                  createdAt: now,
                })),
              ),
            );
          }
        }

        return { client: row!, projectIds: yield* projectIdsOf(input.id) };
      }),

    delete: (scope: AgencyScope, id: string) =>
      Effect.gen(function* () {
        yield* requireClient(scope, id);
        yield* Effect.promise(() => db.delete(clients).where(eq(clients.id, id)));
        return { deleted: true as const };
      }),
  };
}

export type ClientsService = ReturnType<typeof createClientsService>;
