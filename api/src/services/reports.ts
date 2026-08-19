import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { billings, budgets, clientProjects, clients } from "../db/schema";
import type { PluginsClient } from "../lib/plugins-types.gen";
import type { AgencyService } from "./agency";
import { sumByToken } from "./report-tokens";
import { enrichWithChainStatus } from "./sputnik";

export function createReportsService(db: Database, agency: AgencyService, plugins: PluginsClient) {
  return {
    generate: (
      context: Record<string, unknown>,
      orgAccountId: string,
      input: {
        clientId?: string;
        projectId?: string;
        note?: string;
        startDate?: string;
        endDate?: string;
      },
    ) =>
      Effect.gen(function* () {
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

        if (input.clientId) {
          const clientRows = yield* Effect.promise(() =>
            db.select().from(clients).where(eq(clients.id, input.clientId!)).limit(1),
          );
          if (!clientRows[0]) {
            return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Client not found" }));
          }
          const links = yield* Effect.promise(() =>
            db
              .select({ projectId: clientProjects.projectId })
              .from(clientProjects)
              .where(eq(clientProjects.clientId, input.clientId!)),
          );
          projectIds = links.map((l) => l.projectId);
        } else {
          const projects = yield* Effect.promise(() =>
            agency.fetchOrgProjects(orgAccountId, context),
          );
          projectIds = projects.map((p) => p.id);
        }

        if (input.projectId) {
          if (!projectIds.includes(input.projectId)) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", {
                message: input.clientId
                  ? "Project not linked to this client"
                  : "Project not found in this agency",
              }),
            );
          }
          projectIds = [input.projectId];
        }

        const allProjects = yield* Effect.promise(() =>
          agency.fetchOrgProjects(orgAccountId, context),
        );
        const projectById = new Map(allProjects.map((p) => [p.id, p]));

        const budgetRowsAll =
          projectIds.length > 0
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
                  .where(
                    and(
                      inArray(billings.projectId, projectIds),
                      input.clientId ? eq(billings.clientId, input.clientId) : undefined,
                    ),
                  )
                  .orderBy(desc(billings.createdAt)),
              )
            : [];

        const budgetRows = budgetRowsAll.filter(inPeriod);
        const billingRowsRaw = billingRowsRawAll.filter(inPeriod);

        const [clientRows, clientLinkRows] = yield* Effect.promise(() =>
          Promise.all([
            db.select().from(clients).orderBy(desc(clients.name)),
            projectIds.length > 0
              ? db
                  .select()
                  .from(clientProjects)
                  .where(inArray(clientProjects.projectId, projectIds))
              : Promise.resolve([]),
          ]),
        );

        const billingRows = yield* Effect.promise(() =>
          Promise.all(billingRowsRaw.map((b) => enrichWithChainStatus(db, b as any, orgAccountId))),
        );

        const buildersResult = yield* Effect.promise(() =>
          plugins.builders(context).listBuilders({ limit: 100 }),
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

        const clientById = new Map(clientRows.map((c) => [c.id, c]));
        const projectsByClient = new Map<string, string[]>();
        for (const link of clientLinkRows) {
          const list = projectsByClient.get(link.clientId) ?? [];
          list.push(link.projectId);
          projectsByClient.set(link.clientId, list);
        }

        const clientBreakdown: Array<{
          clientName: string;
          projectTitle: string;
          projectSlug: string;
          budgetByToken: ReturnType<typeof sumByToken>;
          spentByToken: ReturnType<typeof sumByToken>;
        }> = [];

        const relevantClientIds = input.clientId
          ? [input.clientId]
          : [...new Set(clientLinkRows.map((l) => l.clientId))];

        for (const clientId of relevantClientIds) {
          const client = clientById.get(clientId);
          if (!client) continue;
          const pids = (projectsByClient.get(clientId) ?? []).filter((pid) =>
            projectIds.includes(pid),
          );
          for (const pid of pids) {
            const project = projectById.get(pid);
            const projectBudgets = budgetRows.filter((b) => b.projectId === pid);
            const projectBillings = paidBillings.filter((b) => b.projectId === pid);
            clientBreakdown.push({
              clientName: client.name,
              projectTitle: project?.title ?? pid,
              projectSlug: project?.slug ?? pid,
              budgetByToken: sumByToken(projectBudgets),
              spentByToken: sumByToken(projectBillings),
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
