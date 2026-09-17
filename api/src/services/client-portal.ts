import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { type AgencyScope, agencyScopeForClient, type PluginContext } from "../lib/agency-scope";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { ClientsService } from "./clients";
import type { ProjectLedgers } from "./ledger";
import type { ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import type { ReportsService } from "./reports";

async function resolveClientScope(
  clientsService: ClientsService,
  nearAccountId: string,
  agencyDaoAccountId: string,
) {
  const lookup = await Effect.runPromise(
    clientsService.getByNearAndAgency(nearAccountId, agencyDaoAccountId),
  );
  if (!lookup) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "No client portal for this wallet at this agency. Ask your agency to add your NEAR account under Clients.",
    });
  }
  return lookup;
}

function assertLinkedProject(projectIds: string[], projectId: string) {
  if (!projectIds.includes(projectId)) {
    throw new ORPCError("NOT_FOUND", { message: "Project not found" });
  }
}

export function createClientPortalService(
  clientsService: ClientsService,
  agency: AgencyService,
  billings: BillingsService,
  reports: ReportsService,
  directory: ProjectDirectory,
  projectLedgers: ProjectLedgers,
) {
  const notFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

  const clientScope = (context: PluginContext, agencyDaoAccountId: string) =>
    Effect.gen(function* () {
      const nearAccountId = context.near?.primaryAccountId;
      if (!nearAccountId) {
        return yield* Effect.fail(
          new ORPCError("FORBIDDEN", {
            message: "Sign in with your NEAR wallet to use the client portal.",
          }),
        );
      }
      const client = yield* Effect.promise(() =>
        resolveClientScope(clientsService, nearAccountId, agencyDaoAccountId),
      );
      const scope: AgencyScope | null =
        client.projectIds.length === 0
          ? null
          : agencyScopeForClient(context, client.client.agencyDaoAccountId);
      return { client: client.client, projectIds: client.projectIds, scope };
    });

  return {
    listProjects: (context: PluginContext, input: { agencyDaoAccountId: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope) return { data: [] };
        const linked = new Set(projectIds);
        const all = yield* Effect.promise(() => directory.forAgency(scope).list());
        return {
          data: all.filter((p) => linked.has(p.id)).map((p) => ({ ...p, nearnListingId: null })),
        };
      }),

    getProject: (context: PluginContext, input: { agencyDaoAccountId: string; slug: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope) return yield* Effect.fail(notFound());
        const detail = yield* agency.getProject(scope, input.slug);
        assertLinkedProject(projectIds, detail.project.id);
        return detail;
      }),

    getBudget: (context: PluginContext, input: { agencyDaoAccountId: string; projectId: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope) return yield* Effect.fail(notFound());
        assertLinkedProject(projectIds, input.projectId);
        return yield* agency.getBudget(scope, input.projectId);
      }),

    listBillings: (
      context: PluginContext,
      input: { agencyDaoAccountId: string; projectId?: string; cursor?: string; limit: number },
    ) =>
      Effect.gen(function* () {
        const { scope, client, projectIds } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope) return { data: [], nextCursor: null };
        if (input.projectId) assertLinkedProject(projectIds, input.projectId);
        return yield* billings.list(scope, {
          projectId: input.projectId,
          projectIds,
          clientId: client.id,
          cursor: input.cursor,
          limit: input.limit,
        });
      }),

    generateReport: (
      context: PluginContext,
      input: { agencyDaoAccountId: string; note?: string; startDate?: string; endDate?: string },
    ) =>
      Effect.gen(function* () {
        const { scope, client } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "No projects linked to this client account." }),
          );
        }
        return yield* reports.generate(scope, {
          clientId: client.id,
          note: input.note,
          startDate: input.startDate,
          endDate: input.endDate,
        });
      }),

    dashboardSummary: (context: PluginContext, input: { agencyDaoAccountId: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds: linked } = yield* clientScope(context, input.agencyDaoAccountId);
        if (!scope || linked.length === 0) return { projectCount: 0, remainingByToken: [] };

        const agencyProjectIds = new Set(
          (yield* Effect.promise(() => directory.forAgency(scope).list())).map((p) => p.id),
        );
        const projectIds = linked.filter((id) => agencyProjectIds.has(id));
        const ledger = yield* Effect.promise(() => projectLedgers.load(scope, projectIds));

        const remainingRows: Array<{ tokenId: string; amount: string }> = [];
        for (const projectId of projectIds) {
          for (const row of ledger.rollupsFor(projectId)) {
            if (BigInt(row.remaining) > 0n) {
              remainingRows.push({ tokenId: row.tokenId, amount: row.remaining });
            }
          }
        }

        return {
          projectCount: projectIds.length,
          remainingByToken: sumByToken(remainingRows),
        };
      }),
  };
}

export type ClientPortalService = ReturnType<typeof createClientPortalService>;
