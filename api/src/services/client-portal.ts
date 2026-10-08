import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { PluginContext } from "../lib/organizations";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { ProjectLedgers } from "./ledger";
import {
  type AgencyScope,
  hasRole,
  type OrganizationAccessService,
  ROLE_MATRIX,
  type SharedEngagement,
  type TreasuryScope,
} from "./organization-access";
import type { Project, ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import { clientSafe, type ReportInput, type ReportsService, type ReportViewer } from "./reports";

const notFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

function assertShared(shared: SharedEngagement, projectId: string) {
  if (!shared.projectIds.includes(projectId)) throw notFound();
}

function withTreasury(scope: AgencyScope): TreasuryScope | null {
  return scope.agencyDao ? (scope as TreasuryScope) : null;
}

type ClientReportInput = {
  engagementId: string;
  projectId?: string;
  note?: string;
  startDate?: string;
  endDate?: string;
};

function clientReportInput(engagement: SharedEngagement, input: ClientReportInput): ReportInput {
  if (input.projectId) assertShared(engagement, input.projectId);
  return {
    engagementId: engagement.engagement.id,
    projectId: input.projectId,
    forClient: true,
    note: input.note,
    startDate: input.startDate,
    endDate: input.endDate,
    subcontractorDao:
      engagement.engagement.kind === "subcontract" ? (engagement.viewerAgencyDao ?? "") : undefined,
  };
}

function clientViewer(context: PluginContext, engagement: SharedEngagement): ReportViewer {
  return {
    organizationId: engagement.engagement.clientOrganizationId,
    userId: context.userId ?? engagement.scope.actorId,
    canManage: hasRole(ROLE_MATRIX.manage, engagement.viewerRole),
    side: "client",
  };
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

    listAllProjects: (context: PluginContext) =>
      Effect.gen(function* () {
        const engagements = yield* Effect.promise(() => access.sharedEngagementsOf(context));
        const perEngagement = yield* Effect.forEach(
          engagements,
          (engagement) =>
            Effect.gen(function* () {
              const projects = yield* sharedProjects(engagement);
              return yield* Effect.forEach(
                projects,
                (project) =>
                  agency.getProject(engagement.scope, project.slug).pipe(
                    Effect.map((detail) => detail.contributors ?? []),
                    Effect.orElseSucceed(() => []),
                    Effect.map((contributors) => ({
                      engagementId: engagement.engagement.id,
                      readOnly: engagement.readOnly,
                      project: { ...project, nearnListingId: null },
                      contributors,
                    })),
                  ),
                { concurrency: 4 },
              );
            }),
          { concurrency: 4 },
        );
        return { data: perEngagement.flat() };
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

    previewReport: (context: PluginContext, input: ClientReportInput) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        const report = yield* reports.generate(
          engagement.scope,
          clientReportInput(engagement, input),
        );
        return clientSafe(report);
      }),

    generateReport: (context: PluginContext, input: ClientReportInput) =>
      Effect.gen(function* () {
        const engagement = yield* shared(context, input.engagementId);
        const report = yield* reports.generateSaved(
          engagement.scope,
          clientReportInput(engagement, input),
          {
            organizationId: engagement.engagement.clientOrganizationId,
            userId: context.userId ?? engagement.scope.actorId,
          },
        );
        return clientSafe(report);
      }),

    listReports: async (context: PluginContext, input: { engagementId: string }) => {
      const engagement = await access.sharedWith(context, input.engagementId);
      return reports.listForClient(engagement.engagement, clientViewer(context, engagement));
    },

    getReport: async (context: PluginContext, input: { engagementId: string; id: string }) => {
      const engagement = await access.sharedWith(context, input.engagementId);
      return reports.getForClient(
        engagement.engagement,
        input.id,
        clientViewer(context, engagement),
      );
    },

    deleteReport: async (context: PluginContext, input: { engagementId: string; id: string }) => {
      const engagement = await access.sharedWith(context, input.engagementId);
      return reports.deleteSaved(clientViewer(context, engagement), input.id, {
        engagementId: engagement.engagement.id,
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
