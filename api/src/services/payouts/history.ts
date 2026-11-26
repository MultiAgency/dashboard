import { type AnyColumn, and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db";
import { agentPayouts, workOrders } from "../../db/schema";

export type FundingCheck = {
  balanceNear: string | null;
  neededNear: string;
  shortfallNear: string | null;
  monthlyBudgetUsd: string | null;
  monthlyRemainingUsd: string | null;
  monthlyNeededUsd: string | null;
  suggestedBudgetUsd: string | null;
  budgetTooLow: boolean;
  lowBalance: boolean;
};

export function payoutRetryable(payout: { status: string; provenUnsent: boolean }): boolean {
  return payout.status === "refused" || (payout.status === "failed" && payout.provenUnsent);
}

export function payoutSettledUnsent(payout: { status: string; provenUnsent: boolean }): boolean {
  return payoutRetryable(payout) || payout.status === "rejected";
}

export function noUnsettledPayout(requestId: AnyColumn) {
  return sql`not exists (select 1 from ${agentPayouts} where ${agentPayouts.requestId} = ${requestId} and not (${agentPayouts.status} = 'refused' or (${agentPayouts.status} = 'failed' and ${agentPayouts.provenUnsent})))`;
}

export function oldPayoutLatest(db: Database) {
  return async (requestId: string) => {
    const [row] = await db
      .select()
      .from(agentPayouts)
      .where(eq(agentPayouts.requestId, requestId))
      .orderBy(desc(agentPayouts.attempt))
      .limit(1);
    return row ?? null;
  };
}

export function workOrderPayees(db: Database) {
  return async (organizationId: string) =>
    (
      await db
        .selectDistinct({ payee: workOrders.builderNearAccount })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.organizationId, organizationId),
            inArray(workOrders.status, ["accepted", "active", "ended", "exhausted"]),
            inArray(workOrders.tokenId, ["usd", "near"]),
          ),
        )
    ).map((r) => r.payee);
}
