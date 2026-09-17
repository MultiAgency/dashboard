import { Effect } from "every-plugin/effect";
import type { AgencyScope } from "../lib/agency-scope";
import type { ProjectLedgers } from "./ledger";
import type { ProjectDirectory } from "./project-directory";
import { getDaoTokenIds, getTreasuryBalances } from "./sputnik";
import { summarizeTreasury } from "./summaries";
import { NATIVE_TOKEN_ID } from "./tokens";

export function createTreasuryService(directory: ProjectDirectory, projectLedgers: ProjectLedgers) {
  return {
    getPublicBalances: (scope: AgencyScope, input: { tokenIds: string[] }) =>
      Effect.gen(function* () {
        const balances = yield* Effect.promise(() =>
          getTreasuryBalances(scope.agencyDao, input.tokenIds),
        );
        return {
          balances: input.tokenIds.map((tokenId) => ({
            tokenId,
            balance: balances[tokenId] ?? "0",
          })),
        };
      }),

    getBalances: (scope: AgencyScope, input: { tokenIds: string[] }) =>
      Effect.gen(function* () {
        const projects = yield* Effect.promise(() => directory.forAgency(scope).list());
        const [ledger, balances] = yield* Effect.promise(() =>
          Promise.all([
            projectLedgers.load(
              scope,
              projects.map((p) => p.id),
            ),
            getTreasuryBalances(scope.agencyDao, input.tokenIds),
          ]),
        );
        return {
          balances: ledger.agencyRollups(balances, input.tokenIds).map((r) => ({
            tokenId: r.tokenId,
            balance: r.balance,
            totalBudgeted: r.budgeted,
            available: r.available,
          })),
        };
      }),

    getRollups: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const projects = yield* Effect.promise(() => directory.forAgency(scope).list());
        const ledger = yield* Effect.promise(() =>
          projectLedgers.load(
            scope,
            projects.filter((p) => p.status !== "archived").map((p) => p.id),
          ),
        );
        const balances =
          ledger.tokenIds.length > 0
            ? yield* Effect.promise(() => getTreasuryBalances(scope.agencyDao, ledger.tokenIds))
            : {};
        return { rollups: ledger.agencyRollups(balances) };
      }),

    getPublicSummary: (scope: AgencyScope) =>
      Effect.gen(function* () {
        const [balances, tokenIds] = yield* Effect.promise(() =>
          Promise.all([
            getTreasuryBalances(scope.agencyDao, [NATIVE_TOKEN_ID]),
            getDaoTokenIds(scope.agencyDao),
          ]),
        );
        return summarizeTreasury(balances, tokenIds);
      }),
  };
}

export type TreasuryService = ReturnType<typeof createTreasuryService>;
