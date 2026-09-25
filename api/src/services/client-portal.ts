import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { PluginContext } from "../lib/organizations";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { ProjectLedgers } from "./ledger";
import type { OrganizationAccessService } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import type { ReportsService } from "./reports";

function assertLinkedProject(projectIds: string[], projectId: string) {
  if (!projectIds.includes(projectId)) {
    throw new ORPCError("NOT_FOUND", { message: "Project not found" });
  }
}

export function createClientPortalService(
  access: OrganizationAccessService,
  agency: AgencyService,
  billings: BillingsService,
  reports: ReportsService,
  directory: ProjectDirectory,
  projectLedgers: ProjectLedgers,
) {
  const notFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

  return {
    listProjects: (context: PluginContext, input: { agencyDaoAccountId: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* access.clientPortal(context, input.agencyDaoAccountId);
        if (!scope) return { data: [] };
        const linked = new Set(projectIds);
        const all = yield* Effect.promise(() => directory.forAgency(scope).list());
        return {
          data: all.filter((p) => linked.has(p.id)).map((p) => ({ ...p, nearnListingId: null })),
        };
      }),

    getProject: (context: PluginContext, input: { agencyDaoAccountId: string; slug: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* access.clientPortal(context, input.agencyDaoAccountId);
        if (!scope) return yield* Effect.fail(notFound());
        const detail = yield* agency.getProject(scope, input.slug);
        assertLinkedProject(projectIds, detail.project.id);
        return detail;
      }),

    getBudget: (context: PluginContext, input: { agencyDaoAccountId: string; projectId: string }) =>
      Effect.gen(function* () {
        const { scope, projectIds } = yield* access.clientPortal(context, input.agencyDaoAccountId);
        if (!scope) return yield* Effect.fail(notFound());
        assertLinkedProject(projectIds, input.projectId);
        return yield* agency.getBudget(scope, input.projectId);
      }),

    listBillings: (
      context: PluginContext,
      input: { agencyDaoAccountId: string; projectId?: string; cursor?: string; limit: number },
    ) =>
      Effect.gen(function* () {
        const { scope, client, projectIds } = yield* access.clientPortal(
          context,
          input.agencyDaoAccountId,
        );
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
        const { scope, client } = yield* access.clientPortal(context, input.agencyDaoAccountId);
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
        const { scope, projectIds: linked } = yield* access.clientPortal(
          context,
          input.agencyDaoAccountId,
        );
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
