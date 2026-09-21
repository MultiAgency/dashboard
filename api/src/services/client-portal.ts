import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { hasAgencyDao, type OrgScope, sharedViewScope } from "../lib/agency-scope";
import type { OrganizationAccess } from "../lib/organization-access";
import type { AgencyService } from "./agency";
import type { BillingsService } from "./billings";
import type { EngagementsService } from "./engagements";
import type { ProjectLedgers } from "./ledger";
import type { ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import type { ReportsService } from "./reports";

const projectNotFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

function assertShared(projectIds: string[], projectId: string) {
  if (!projectIds.includes(projectId)) throw projectNotFound();
}

export function createClientPortalService(
  engagements: EngagementsService,
  agency: AgencyService,
  billings: BillingsService,
  reports: ReportsService,
  directory: ProjectDirectory,
  projectLedgers: ProjectLedgers,
  access: Pick<OrganizationAccess, "daoOf">,
) {
  const shared = (scope: OrgScope, engagementId: string) =>
    Effect.gen(function* () {
      const engagement = yield* engagements.asClient(scope, engagementId);
      const agencyOrganizationId = engagement.agency.organizationId;
      const agencyDao = yield* Effect.promise(() => access.daoOf(agencyOrganizationId));
      const view = sharedViewScope(scope, agencyOrganizationId, agencyDao);
      return { engagement, view, projectIds: engagement.projectIds };
    });

  const sharedProjects = (view: OrgScope, projectIds: string[]) =>
    Effect.promise(async () => {
      const linked = new Set(projectIds);
      return (await directory.forAgency(view).list()).filter((p) => linked.has(p.id));
    });

  return {
    listProjects: (scope: OrgScope, input: { engagementId: string }) =>
      Effect.gen(function* () {
        const { view, projectIds } = yield* shared(scope, input.engagementId);
        const projects = yield* sharedProjects(view, projectIds);
        return { data: projects.map((p) => ({ ...p, nearnListingId: null })) };
      }),

    getProject: (scope: OrgScope, input: { engagementId: string; slug: string }) =>
      Effect.gen(function* () {
        const { view, projectIds } = yield* shared(scope, input.engagementId);
        const detail = yield* agency.getProject(view, input.slug);
        assertShared(projectIds, detail.project.id);
        return detail;
      }),

    getBudget: (scope: OrgScope, input: { engagementId: string; projectId: string }) =>
      Effect.gen(function* () {
        const { engagement, view, projectIds } = yield* shared(scope, input.engagementId);
        assertShared(projectIds, input.projectId);
        if (engagement.kind === "subcontract" || !hasAgencyDao(view)) return { budgets: [] };
        return yield* agency.getBudget(view, input.projectId);
      }),

    listBillings: (
      scope: OrgScope,
      input: { engagementId: string; projectId?: string; cursor?: string; limit: number },
    ) =>
      Effect.gen(function* () {
        const { view, projectIds } = yield* shared(scope, input.engagementId);
        if (input.projectId) assertShared(projectIds, input.projectId);
        if (!hasAgencyDao(view) || projectIds.length === 0) return { data: [], nextCursor: null };
        return yield* billings.list(view, {
          projectId: input.projectId,
          projectIds,
          cursor: input.cursor,
          limit: input.limit,
        });
      }),

    generateReport: (
      scope: OrgScope,
      input: { engagementId: string; note?: string; startDate?: string; endDate?: string },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* engagements.forParty(scope, input.engagementId);
        const agencyDao =
          engagement.role === "agency" && hasAgencyDao(scope)
            ? scope.agencyDao
            : yield* Effect.promise(() => access.daoOf(engagement.agency.organizationId));
        const view =
          engagement.role === "agency" && hasAgencyDao(scope)
            ? scope
            : sharedViewScope(scope, engagement.agency.organizationId, agencyDao);
        if (!hasAgencyDao(view) || engagement.projectIds.length === 0) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: "No projects are shared through this Engagement yet.",
            }),
          );
        }
        return yield* reports.generate(view, {
          projectIds: engagement.projectIds,
          engagementId: engagement.id,
          note: input.note,
          startDate: input.startDate,
          endDate: input.endDate,
          includeBudgets: engagement.role === "agency" || engagement.kind !== "subcontract",
        });
      }),

    dashboardSummary: (scope: OrgScope, input: { engagementId: string }) =>
      Effect.gen(function* () {
        const { view, projectIds: linked } = yield* shared(scope, input.engagementId);
        const projects = yield* sharedProjects(view, linked);
        if (!hasAgencyDao(view) || projects.length === 0) {
          return { projectCount: projects.length, remainingByToken: [] };
        }
        const projectIds = projects.map((p) => p.id);
        const ledger = yield* Effect.promise(() => projectLedgers.load(view, projectIds));

        const remainingRows: Array<{ tokenId: string; amount: string }> = [];
        for (const projectId of projectIds) {
          for (const row of ledger.rollupsFor(projectId)) {
            if (BigInt(row.remaining) > 0n) {
              remainingRows.push({ tokenId: row.tokenId, amount: row.remaining });
            }
          }
        }

        return { projectCount: projectIds.length, remainingByToken: sumByToken(remainingRows) };
      }),
  };
}

export type ClientPortalService = ReturnType<typeof createClientPortalService>;
