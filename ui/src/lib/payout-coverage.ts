import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiClient } from "./api";
import { payoutCoverageQueryOptions } from "./queries";

type Coverage = Awaited<ReturnType<ApiClient["workOrders"]["payoutCoverage"]>>;

export function coverageWarning(coverage: Coverage | null): string | null {
  if (!coverage || coverage.covered) return null;
  return coverage.lowBalance
    ? `The payout agent can't cover this work order yet: it holds ${coverage.balanceNear ?? "too little"} NEAR and the budget needs ≈${coverage.neededNear} NEAR. Fund the agent before payouts are due.`
    : `This work order's budget is more than the $${coverage.monthlyRemainingUsd} left in this month's payout budget.`;
}

export async function warnIfPayoutsUncovered(
  queryClient: QueryClient,
  apiClient: ApiClient,
  id: string,
) {
  const coverage = await queryClient
    .fetchQuery(payoutCoverageQueryOptions(apiClient, id))
    .catch(() => null);
  const warning = coverageWarning(coverage);
  if (warning) toast.warning(warning);
}
