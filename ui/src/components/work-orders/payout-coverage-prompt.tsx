import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@/components";
import { useApiClient } from "@/lib/api";
import { payoutCoverageQueryOptions } from "@/lib/queries";
import type { WorkOrderDetail } from "./work-order-status";

const OPEN = ["draft", "offered", "accepted", "active", "ended", "exhausted"];

export function PayoutCoveragePrompt({ workOrder }: { workOrder: WorkOrderDetail }) {
  const apiClient = useApiClient();
  const open = OPEN.includes(workOrder.status);
  const coverage = useQuery({
    ...payoutCoverageQueryOptions(apiClient, workOrder.id),
    enabled: open,
  }).data;
  if (!open || !coverage || coverage.covered) return null;
  return (
    <Alert>
      <AlertTitle>The payout agent can't cover this work order yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        {coverage.lowBalance && (
          <span>
            It holds {coverage.balanceNear ?? "an unknown amount of"} NEAR; the unpaid budget (
            {coverage.unpaid}) needs ≈{coverage.neededNear} NEAR. Fund the agent before payouts are
            due.
          </span>
        )}
        {coverage.overMonthly && (
          <span>
            The unpaid budget is ≈${coverage.neededUsd}, more than the $
            {coverage.monthlyRemainingUsd} left in this month's payout budget
            {coverage.monthlyBudgetUsd ? ` of $${coverage.monthlyBudgetUsd}` : ""}. Raise the
            monthly budget or approved payouts wait until it resets.
          </span>
        )}
        <span>
          Approved requests still go through: they're paid automatically once the agent can cover
          them.
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/settings" hash="payouts">
              {coverage.lowBalance ? "Fund the agent" : "Open the payout settings"}
            </Link>
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
