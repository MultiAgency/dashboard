import { inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { Database } from "../db";
import { billings, budgets } from "../db/schema";
import type { AgencyService } from "./agency";
import type { ListingsService } from "./listings";
import { assembleAgencyRollups, computeAvailable, tokenIdsForRollup } from "./rollups";
import { enrichWithChainStatus, getDaoTokenIds, getTreasuryBalances, networkOf } from "./sputnik";
import { summarizeTreasury } from "./summaries";
import { NATIVE_TOKEN_ID } from "./tokens";

export function createTreasuryService(
  db: Database,
  agency: AgencyService,
  listings: ListingsService,
) {
  return {
    getPublicBalances: (context: Record<string, unknown>, input: { tokenIds: string[] }) =>
      Effect.gen(function* () {
        const orgAccountId = yield* agency.getDaoAccountId(context);
        try {
          const balances = yield* Effect.promise(() =>
            getTreasuryBalances(orgAccountId, input.tokenIds),
          );
          return {
            balances: input.tokenIds.map((tokenId) => ({
              tokenId,
              balance: balances[tokenId] ?? "0",
            })),
          };
        } catch {
          return {
            balances: input.tokenIds.map((tokenId) => ({
              tokenId,
              balance: "0",
            })),
          };
        }
      }),

    getBalances: (context: Record<string, unknown>, input: { tokenIds: string[] }) =>
      Effect.gen(function* () {
        const orgId = yield* agency.getDaoAccountId(context);
        const orgProjectIds = (yield* Effect.promise(() =>
          agency.fetchOrgProjects(orgId, context),
        )).map((p: { id: string }) => p.id);

        const [balances, budgetRows, billingRows] =
          orgProjectIds.length > 0
            ? yield* Effect.promise(() =>
                Promise.all([
                  getTreasuryBalances(orgId, input.tokenIds),
                  db
                    .select({
                      tokenId: budgets.tokenId,
                      amount: budgets.amount,
                    })
                    .from(budgets)
                    .where(inArray(budgets.projectId, orgProjectIds)),
                  db
                    .select({
                      id: billings.id,
                      projectId: billings.projectId,
                      contributorId: billings.contributorId,
                      tokenId: billings.tokenId,
                      amount: billings.amount,
                      proposalId: billings.proposalId,
                      note: billings.note,
                      createdAt: billings.createdAt,
                    })
                    .from(billings)
                    .where(inArray(billings.projectId, orgProjectIds)),
                ]),
              )
            : [
                {} as Record<string, string>,
                [] as { tokenId: string; amount: string }[],
                [] as any[],
              ];

        const bills = yield* Effect.promise(() =>
          Promise.all((billingRows as any[]).map((b) => enrichWithChainStatus(db, b, orgId))),
        );

        const budgetedByToken = new Map<string, bigint>();
        for (const row of budgetRows) {
          budgetedByToken.set(
            row.tokenId,
            (budgetedByToken.get(row.tokenId) ?? 0n) + BigInt(row.amount),
          );
        }
        const paidByToken = new Map<string, bigint>();
        for (const b of bills) {
          if (b.status === "Approved") {
            paidByToken.set(b.tokenId, (paidByToken.get(b.tokenId) ?? 0n) + BigInt(b.amount));
          }
        }

        return {
          balances: input.tokenIds.map((tokenId) => {
            const budgeted = budgetedByToken.get(tokenId) ?? 0n;
            const paid = paidByToken.get(tokenId) ?? 0n;
            const balance = BigInt(balances[tokenId] ?? "0");
            return {
              tokenId,
              balance: balance.toString(),
              totalBudgeted: budgeted.toString(),
              available: computeAvailable(balance, budgeted, paid).toString(),
            };
          }),
        };
      }),

    getRollups: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgId = yield* agency.getDaoAccountId(context);
        const orgProjectIds = (yield* Effect.promise(() => agency.fetchOrgProjects(orgId, context)))
          .filter((p: { status: string }) => p.status !== "archived")
          .map((p: { id: string }) => p.id);

        const [budgetRows, billingRows] =
          orgProjectIds.length > 0
            ? yield* Effect.promise(() =>
                Promise.all([
                  db
                    .select({
                      projectId: budgets.projectId,
                      tokenId: budgets.tokenId,
                      amount: budgets.amount,
                    })
                    .from(budgets)
                    .where(inArray(budgets.projectId, orgProjectIds)),
                  db
                    .select({
                      id: billings.id,
                      projectId: billings.projectId,
                      contributorId: billings.contributorId,
                      tokenId: billings.tokenId,
                      amount: billings.amount,
                      proposalId: billings.proposalId,
                      note: billings.note,
                      createdAt: billings.createdAt,
                    })
                    .from(billings)
                    .where(inArray(billings.projectId, orgProjectIds)),
                ]),
              )
            : [
                [] as {
                  projectId: string;
                  tokenId: string;
                  amount: string;
                }[],
                [] as any[],
              ];

        const nearnListings =
          orgProjectIds.length > 0
            ? yield* listings.getListingsForProjects(orgProjectIds, "nearn", orgId)
            : new Map<string, any>();
        const internalListings =
          orgProjectIds.length > 0
            ? yield* listings.getListingsForProjects(orgProjectIds, "internal", orgId)
            : new Map<string, any>();

        const bills = yield* Effect.promise(() =>
          Promise.all((billingRows as any[]).map((b) => enrichWithChainStatus(db, b, orgId))),
        );

        const rollupArgs = {
          projectIds: orgProjectIds,
          budgetRows,
          billingRows: bills.map((b) => ({
            projectId: (b as any).projectId,
            tokenId: (b as any).tokenId,
            amount: (b as any).amount,
            status: (b as any).status,
          })) as any,
          nearnListings,
          internalListings,
          network: networkOf(orgId),
        };
        const tokenIds = tokenIdsForRollup(rollupArgs);
        const balances =
          tokenIds.length > 0
            ? yield* Effect.promise(() => getTreasuryBalances(orgId, tokenIds))
            : {};
        return {
          rollups: assembleAgencyRollups({ ...rollupArgs, balances }),
        };
      }),

    getPublicSummary: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* agency.getDaoAccountId(context);
        try {
          const [balances, tokenIds] = yield* Effect.promise(() =>
            Promise.all([
              getTreasuryBalances(orgAccountId, [NATIVE_TOKEN_ID]),
              getDaoTokenIds(orgAccountId),
            ]),
          );
          return summarizeTreasury(balances, tokenIds);
        } catch {
          return summarizeTreasury({}, []);
        }
      }),
  };
}

export type TreasuryService = ReturnType<typeof createTreasuryService>;
