import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { billings, budgets, engagementProjects, engagements } from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import type { PluginsClient } from "../lib/plugins-types.gen";
import type { AgencyScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";
import { sumByToken } from "./report-tokens";
import { enrichWithChainStatus } from "./sputnik";

export function createReportsService(
  db: Database,
  directory: ProjectDirectory,
  plugins: PluginsClient,
  organizations: Pick<OrganizationDirectory, "get">,
) {
  return {
    generate: (
      scope: AgencyScope,
      input: {
        engagementId?: string;
        projectId?: string;
        note?: string;
        startDate?: string;
        endDate?: string;
        subcontractorDao?: string;
      },
    ) =>
      Effect.gen(function* () {
        const { agencyDao } = scope;
        const { subcontractorDao } = input;
        const allProjects = yield* Effect.promise(() => directory.forAgency(scope).list());
        let projectIds: string[];

        const startAt = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null;
        const endAt = input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : null;
        if (startAt && endAt && startAt > endAt) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "startDate must be on or before endDate" }),
          );
        }

        const inPeriod = <T extends { createdAt: Date }>(row: T) => {
          if (startAt && row.createdAt < startAt) return false;
          if (endAt && row.createdAt > endAt) return false;
          return true;
        };

        const agencyEngagements = scope.organizationId
          ? yield* Effect.promise(() =>
              db
                .select()
                .from(engagements)
                .where(
                  and(
                    eq(engagements.agencyOrganizationId, scope.organizationId!),
                    inArray(engagements.status, ["active", "ended"]),
                  ),
                ),
            )
          : [];
        const reported = input.engagementId
          ? agencyEngagements.filter((e) => e.id === input.engagementId)
          : agencyEngagements;
        if (input.engagementId && reported.length === 0) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Engagement not found" }),
          );
        }
        const links =
          reported.length > 0
            ? yield* Effect.promise(() =>
                db
                  .select()
                  .from(engagementProjects)
                  .where(
                    inArray(
                      engagementProjects.engagementId,
                      reported.map((e) => e.id),
                    ),
                  ),
              )
            : [];

        const agencyProjectIds = new Set(allProjects.map((p) => p.id));
        projectIds = input.engagementId
          ? [...new Set(links.map((l) => l.projectId))].filter((id) => agencyProjectIds.has(id))
          : allProjects.map((p) => p.id);

        if (input.projectId) {
          if (!projectIds.includes(input.projectId)) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: input.engagementId
                  ? "Project not shared through this Engagement"
                  : "Project not found in this agency",
              }),
            );
          }
          projectIds = [input.projectId];
        }

        const projectById = new Map(allProjects.map((p) => [p.id, p]));

        const budgetRowsAll =
          projectIds.length > 0 && subcontractorDao === undefined
            ? yield* Effect.promise(() =>
                db.select().from(budgets).where(inArray(budgets.projectId, projectIds)),
              )
            : [];
        const billingRowsRawAll =
          projectIds.length > 0
            ? yield* Effect.promise(() =>
                db
                  .select()
                  .from(billings)
                  .where(inArray(billings.projectId, projectIds))
                  .orderBy(desc(billings.createdAt)),
              )
            : [];

        const budgetRows = budgetRowsAll.filter(inPeriod);
        const billingRowsRaw = billingRowsRawAll.filter(inPeriod);

        const clientNames = yield* Effect.promise(async () => {
          const ids = [...new Set(reported.map((e) => e.clientOrganizationId))];
          const found = await Promise.all(ids.map((id) => organizations.get(id)));
          return new Map(ids.map((id, i) => [id, found[i]?.name ?? id]));
        });

        const billingRows = yield* Effect.promise(() =>
          Promise.all(
            billingRowsRaw
              .filter(
                (b) => subcontractorDao === undefined || b.payingDaoAccountId === subcontractorDao,
              )
              .flatMap((b) => {
                const payingDao = b.payingDaoAccountId ?? agencyDao;
                return payingDao ? [enrichWithChainStatus(db, b, payingDao)] : [];
              }),
          ),
        );

        const buildersResult = yield* Effect.promise(() =>
          plugins.builders(scope.pluginContext).listBuilders({ limit: 100 }),
        );
        const builderByNear = new Map(
          buildersResult.data.map((b) => [b.nearAccount, b.name ?? b.nearAccount]),
        );

        const paidBillings = billingRows.filter((b) => b.status === "Approved");

        const contributorStats = new Map<
          string,
          {
            nearAccount: string;
            name: string;
            billedRows: Array<{ tokenId: string; amount: string }>;
            count: number;
          }
        >();
        for (const b of paidBillings) {
          if (!b.nearAccount) continue;
          const existing = contributorStats.get(b.nearAccount) ?? {
            nearAccount: b.nearAccount,
            name: builderByNear.get(b.nearAccount) ?? b.nearAccount,
            billedRows: [] as Array<{ tokenId: string; amount: string }>,
            count: 0,
          };
          existing.billedRows.push({ tokenId: b.tokenId, amount: b.amount });
          existing.count += 1;
          contributorStats.set(b.nearAccount, existing);
        }

        const clientBreakdown: Array<{
          clientName: string;
          projectTitle: string;
          projectSlug: string;
          budgetByToken: ReturnType<typeof sumByToken>;
          spentByToken: ReturnType<typeof sumByToken>;
        }> = [];

        for (const engagement of reported) {
          const clientName =
            clientNames.get(engagement.clientOrganizationId) ?? engagement.clientOrganizationId;
          const pids = links
            .filter((l) => l.engagementId === engagement.id && projectIds.includes(l.projectId))
            .map((l) => l.projectId);
          for (const pid of pids) {
            const project = projectById.get(pid);
            clientBreakdown.push({
              clientName,
              projectTitle: project?.title ?? pid,
              projectSlug: project?.slug ?? pid,
              budgetByToken: sumByToken(budgetRows.filter((b) => b.projectId === pid)),
              spentByToken: sumByToken(paidBillings.filter((b) => b.projectId === pid)),
            });
          }
        }

        const period =
          input.startDate && input.endDate
            ? `${input.startDate} – ${input.endDate}`
            : input.startDate
              ? `from ${input.startDate}`
              : input.endDate
                ? `through ${input.endDate}`
                : "all time";

        return {
          overview: {
            projectCount: projectIds.length,
            budgetByToken: sumByToken(budgetRows),
            billedByToken: sumByToken(paidBillings),
            period,
          },
          contributorStats: [...contributorStats.values()].map((s) => ({
            nearAccount: s.nearAccount,
            name: s.name,
            billedByToken: sumByToken(s.billedRows),
            billingCount: s.count,
          })),
          clientBreakdown,
          notes: input.note ?? "",
          generatedAt: new Date().toISOString(),
        };
      }),
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
