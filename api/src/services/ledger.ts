import { inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { Database } from "../db";
import { billings, budgets, type Listing } from "../db/schema";
import type { AgencyScope } from "../lib/agency-scope";
import type { ListingsService } from "./listings";
import { type DaoProposalStatus, enrichWithChainStatus } from "./sputnik";
import { displayToBaseUnits, getTokenMetadataBySymbol } from "./tokens";

export type ProjectRollup = {
  tokenId: string;
  budget: string;
  allocated: string;
  committed: string;
  paid: string;
  remaining: string;
};

export type AgencyRollup = {
  tokenId: string;
  balance: string;
  budgeted: string;
  allocated: string;
  committed: string;
  paid: string;
  remaining: string;
  available: string;
};

export type ProjectLedger = {
  tokenIds: string[];
  rollupsFor(projectId: string): ProjectRollup[];
  agencyRollups(balances: Record<string, string>, tokenIds?: string[]): AgencyRollup[];
};

const PROPOSAL_TERMINAL_FAIL = new Set<DaoProposalStatus>([
  "Rejected",
  "Removed",
  "Expired",
  "Moved",
  "Failed",
]);

type ResolvedListing = {
  tokenId: string;
  baseAmount: bigint;
  isWinnersAnnounced: boolean;
};

type BillingForRollup = {
  amount: string;
  status: DaoProposalStatus;
};

type TokenRollup = {
  tokenId: string;
  budget: bigint;
  allocated: bigint;
  committed: bigint;
  paid: bigint;
  remaining: bigint;
};

function resolveActiveListing(
  nearnListing: Listing | null,
  internalListing: Listing | null,
  network: "mainnet" | "testnet",
): ResolvedListing | null {
  const active = nearnListing ?? internalListing;
  if (!active) return null;
  if (active.isPublished !== true || active.isArchived !== false) return null;
  if (!active.token || !active.rewardAmount) return null;
  const known = getTokenMetadataBySymbol(active.token, network);
  if (!known) return null;
  return {
    tokenId: known.tokenId,
    baseAmount: displayToBaseUnits(active.rewardAmount, known.decimals),
    isWinnersAnnounced: active.isWinnersAnnounced === true,
  };
}

function rollupForToken(input: {
  tokenId: string;
  budgetAmounts: bigint[];
  billings: BillingForRollup[];
  listing: ResolvedListing | null;
}): TokenRollup {
  const matchingListing =
    input.listing && input.listing.tokenId === input.tokenId ? input.listing : null;
  const tokenBills = input.billings.filter((b) => !PROPOSAL_TERMINAL_FAIL.has(b.status));

  const sumBills = (predicate: (b: BillingForRollup) => boolean) =>
    tokenBills.filter(predicate).reduce((acc, b) => acc + BigInt(b.amount), 0n);

  const budget = input.budgetAmounts.reduce((acc, a) => acc + a, 0n);
  const inProgressBillings = sumBills((b) => b.status === "InProgress");
  const paid = sumBills((b) => b.status === "Approved");

  let listingAllocated = 0n;
  let listingCommitted = 0n;
  if (matchingListing) {
    if (matchingListing.isWinnersAnnounced) {
      if (tokenBills.length === 0) listingCommitted = matchingListing.baseAmount;
    } else {
      listingAllocated = matchingListing.baseAmount;
    }
  }

  const allocated = listingAllocated;
  const committed = listingCommitted + inProgressBillings;
  const remaining = budget - allocated - committed - paid;

  return { tokenId: input.tokenId, budget, allocated, committed, paid, remaining };
}

function computeAvailable(balance: bigint, budgeted: bigint, paid: bigint): bigint {
  return balance - (budgeted - paid);
}

function toProjectRollup(r: TokenRollup): ProjectRollup {
  return {
    tokenId: r.tokenId,
    budget: r.budget.toString(),
    allocated: r.allocated.toString(),
    committed: r.committed.toString(),
    paid: r.paid.toString(),
    remaining: r.remaining.toString(),
  };
}

async function loadRows(
  db: Database,
  listings: ListingsService,
  scope: AgencyScope,
  projectIds: string[],
) {
  if (projectIds.length === 0) {
    return { budgetRows: [], bills: [], nearnListings: new Map(), internalListings: new Map() };
  }
  const [budgetRows, billingRows, nearnListings, internalListings] = await Promise.all([
    db
      .select({ projectId: budgets.projectId, tokenId: budgets.tokenId, amount: budgets.amount })
      .from(budgets)
      .where(inArray(budgets.projectId, projectIds)),
    db
      .select({
        projectId: billings.projectId,
        tokenId: billings.tokenId,
        amount: billings.amount,
        proposalId: billings.proposalId,
      })
      .from(billings)
      .where(inArray(billings.projectId, projectIds)),
    Effect.runPromise(listings.forProjects(scope, projectIds, "nearn")),
    Effect.runPromise(listings.forProjects(scope, projectIds, "internal")),
  ]);
  const bills = await Promise.all(
    billingRows.map((b) => enrichWithChainStatus(db, b, scope.agencyDao)),
  );
  return { budgetRows, bills, nearnListings, internalListings };
}

export function createProjectLedgers(db: Database, listings: ListingsService) {
  return {
    load: async (scope: AgencyScope, projectIds: string[]): Promise<ProjectLedger> => {
      const { budgetRows, bills, nearnListings, internalListings } = await loadRows(
        db,
        listings,
        scope,
        projectIds,
      );

      const rollupsByProject = new Map<string, TokenRollup[]>();
      for (const projectId of new Set(projectIds)) {
        const projectBudgets = budgetRows.filter((b) => b.projectId === projectId);
        const projectBills = bills.filter((b) => b.projectId === projectId);
        const listing = resolveActiveListing(
          nearnListings.get(projectId) ?? null,
          internalListings.get(projectId) ?? null,
          scope.network,
        );
        const tokenIds = Array.from(
          new Set([
            ...projectBudgets.map((b) => b.tokenId),
            ...projectBills.map((b) => b.tokenId),
            ...(listing ? [listing.tokenId] : []),
          ]),
        ).sort();
        rollupsByProject.set(
          projectId,
          tokenIds.map((tokenId) =>
            rollupForToken({
              tokenId,
              budgetAmounts: projectBudgets
                .filter((b) => b.tokenId === tokenId)
                .map((b) => BigInt(b.amount)),
              billings: projectBills
                .filter((b) => b.tokenId === tokenId)
                .map((b) => ({ amount: b.amount, status: b.status })),
              listing,
            }),
          ),
        );
      }

      const totals = new Map<string, Omit<TokenRollup, "tokenId">>();
      for (const rollups of rollupsByProject.values()) {
        for (const r of rollups) {
          const t = totals.get(r.tokenId) ?? {
            budget: 0n,
            allocated: 0n,
            committed: 0n,
            paid: 0n,
            remaining: 0n,
          };
          t.budget += r.budget;
          t.allocated += r.allocated;
          t.committed += r.committed;
          t.paid += r.paid;
          t.remaining += r.remaining;
          totals.set(r.tokenId, t);
        }
      }
      const ledgerTokenIds = Array.from(totals.keys()).sort();

      return {
        tokenIds: ledgerTokenIds,

        rollupsFor: (projectId) => (rollupsByProject.get(projectId) ?? []).map(toProjectRollup),

        agencyRollups: (balances, tokenIds = ledgerTokenIds) =>
          tokenIds.map((tokenId) => {
            const t = totals.get(tokenId);
            const budgeted = t?.budget ?? 0n;
            const paid = t?.paid ?? 0n;
            const balance = BigInt(balances[tokenId] ?? "0");
            return {
              tokenId,
              balance: balance.toString(),
              budgeted: budgeted.toString(),
              allocated: (t?.allocated ?? 0n).toString(),
              committed: (t?.committed ?? 0n).toString(),
              paid: paid.toString(),
              remaining: (t?.remaining ?? 0n).toString(),
              available: computeAvailable(balance, budgeted, paid).toString(),
            };
          }),
      };
    },
  };
}

export type ProjectLedgers = ReturnType<typeof createProjectLedgers>;
