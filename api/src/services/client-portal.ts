import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { PluginContext } from "../lib/organizations";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { ProjectLedgers } from "./ledger";
import type {
  AgencyScope,
  OrganizationAccessService,
  SharedEngagement,
  TreasuryScope,
} from "./organization-access";
import type { Project, ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import type { ReportsService } from "./reports";

const notFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

function assertShared(shared: SharedEngagement, projectId: string) {
  if (!shared.projectIds.includes(projectId)) throw notFound();
}

function withTreasury(scope: AgencyScope): TreasuryScope | null {
  return scope.agencyDao ? (scope as TreasuryScope) : null;
}

export function createClientPortalService(
  access: OrganizationAccessService,
  agency: AgencyService,
  billings: BillingsService,
  reports: ReportsService,
  directory: ProjectDirectory,
  projectLedgers: ProjectLedgers,
) {
  const shared = (context: PluginContext, engagementId: string) =>
    Effect.tryPromise({
      try: () => access.sharedWith(context, engagementId),
      catch: (err) => err,
    });

  const sharedProjects = (engagement: SharedEngagement) =>
    Effect.promise(async () => {
      const projects = directory.forAgency(engagement.scope);
      const found = await Promise.all(
        engagement.projectIds.map((id) => projects.require(id).catch(() => null)),
      );
      return found.filter((p): p is Project => p !== null);
    });

  return {
    listProjects: (context: PluginContext, input: { engagementId: string }) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        const projects = yield* sharedProjects(engagement);
        return { data: projects.map((p) => ({ ...p, nearnListingId: null })) };
      }),

    getProject: (context: PluginContext, input: { engagementId: string; slug: string }) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        const detail = yield* agency.getProject(engagement.scope, input.slug);
        assertShared(engagement, detail.project.id);
        return detail;
      }),

    getBudget: (context: PluginContext, input: { engagementId: string; projectId: string }) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        assertShared(engagement, input.projectId);
        const scope = withTreasury(engagement.scope);
        if (!scope) return { budgets: [], subcontractorSpend: [] };
        const rollup = yield* agency.getBudget(scope, input.projectId);
        if (engagement.engagement.kind !== "subcontract") return rollup;
        return {
          budgets: [],
          subcontractorSpend: rollup.subcontractorSpend.filter(
            (row) => row.daoAccountId === engagement.viewerAgencyDao,
          ),
        };
      }),

    listBillings: (
      context: PluginContext,
      input: { engagementId: string; projectId?: string; cursor?: string; limit: number },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        if (input.projectId) assertShared(engagement, input.projectId);
        const scope = withTreasury(engagement.scope);
        const onlyOwn = engagement.engagement.kind === "subcontract";
        if (
          !scope ||
          engagement.projectIds.length === 0 ||
          (onlyOwn && !engagement.viewerAgencyDao)
        ) {
          return { data: [], nextCursor: null };
        }
        return yield* billings.list(scope, {
          projectId: input.projectId,
          projectIds: engagement.projectIds,
          payingDaoAccountId: onlyOwn ? (engagement.viewerAgencyDao ?? undefined) : undefined,
          cursor: input.cursor,
          limit: input.limit,
        });
      }),

    generateReport: (
      context: PluginContext,
      input: { engagementId: string; note?: string; startDate?: string; endDate?: string },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        return yield* reports.generateSaved(
          engagement.scope,
          {
            engagementId: engagement.engagement.id,
            note: input.note,
            startDate: input.startDate,
            endDate: input.endDate,
            subcontractorDao:
              engagement.engagement.kind === "subcontract"
                ? (engagement.viewerAgencyDao ?? "")
                : undefined,
          },
          {
            organizationId: engagement.engagement.clientOrganizationId,
            userId: context.userId ?? engagement.scope.actorId,
          },
        );
      }),

    listReports: async (context: PluginContext, input: { engagementId: string }) => {
      const { engagement } = await access.sharedWith(context, input.engagementId);
      return reports.listSaved(engagement.clientOrganizationId, { engagementId: engagement.id });
    },

    getReport: async (context: PluginContext, input: { engagementId: string; id: string }) => {
      const { engagement } = await access.sharedWith(context, input.engagementId);
      return reports.getSaved(engagement.clientOrganizationId, input.id, {
        engagementId: engagement.id,
      });
    },

    dashboardSummary: (context: PluginContext, input: { engagementId: string }) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        const projects = yield* sharedProjects(engagement);
        const scope = withTreasury(engagement.scope);
        const base = {
          status: engagement.engagement.status,
          readOnly: engagement.readOnly,
          projectCount: projects.length,
        };
        if (!scope || projects.length === 0 || engagement.engagement.kind === "subcontract") {
          return { ...base, remainingByToken: [] };
        }
        const ledger = yield* Effect.promise(() =>
          projectLedgers.load(
            scope,
            projects.map((p) => p.id),
          ),
        );
        const remainingRows = projects.flatMap((p) =>
          ledger
            .rollupsFor(p.id)
            .filter((row) => BigInt(row.remaining) > 0n)
            .map((row) => ({ tokenId: row.tokenId, amount: row.remaining })),
        );
        return { ...base, remainingByToken: sumByToken(remainingRows) };
      }),
  };
}

export type ClientPortalService = ReturnType<typeof createClientPortalService>;
