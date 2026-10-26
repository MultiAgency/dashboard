import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Button } from "@/components";
import { useApiClient } from "@/lib/api";
import { payoutAgentQueryOptions } from "@/lib/queries";
import { AllowPayeesButton } from "./allow-payees-button";
import type { WorkOrderDetail } from "./work-order-status";

const PAYABLE = ["accepted", "active", "ended", "exhausted"];

export function PayeePayoutsPrompt({ workOrder }: { workOrder: WorkOrderDetail }) {
  const apiClient = useApiClient();
  const query = useQuery(payoutAgentQueryOptions(apiClient));
  const agent = query.data;
  const payee = workOrder.builder.nearAccount;
  if (
    !agent?.agentId ||
    !agent.policy ||
    workOrder.payoutTokenId !== "near" ||
    !PAYABLE.includes(workOrder.status) ||
    agent.policy.payees.includes(payee)
  ) {
    return null;
  }
  const name = workOrder.builder.name ?? payee;
  return (
    <Alert>
      <AlertTitle>The payout agent can't pay {name} yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          The rules you signed don't include {payee}. Sign the updated rules with your wallet so
          approved requests are paid automatically.
        </span>
        <span className="flex flex-wrap gap-2">
          {agent.changes.length > 0 ? (
            <AllowPayeesButton payee={name} />
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/settings" hash="payouts">
                Open the payout settings
              </Link>
            </Button>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
