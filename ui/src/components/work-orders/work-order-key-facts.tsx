import type { ReactNode } from "react";
import { Badge, Card, CardContent } from "@/components";
import { formatTokenAmount } from "@/lib/format-amount";
import { periodRange } from "@/lib/format-date";
import { payeeConfirmedBySigning, type WorkOrderDetail } from "./work-order-status";

function Fact({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{value}</dd>
      {detail && <dd className="min-w-0 truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}

function PayoutAccount({ workOrder: wo }: { workOrder: WorkOrderDetail }) {
  if (wo.payee.confirmedAt) return <Badge variant="success">Confirmed</Badge>;
  if (wo.payee.paidBefore) return <Badge variant="outline">Paid before</Badge>;
  if (payeeConfirmedBySigning(wo)) {
    return <span className="text-muted-foreground">When they sign</span>;
  }
  if (wo.payee.needsConfirmation) return <Badge variant="warning">Not confirmed</Badge>;
  return <span>Their NEAR account</span>;
}

export function WorkOrderKeyFacts({ workOrder: wo }: { workOrder: WorkOrderDetail }) {
  const amount = (value: string) => formatTokenAmount(value, wo.tokenId);
  const name = wo.builder.name ?? wo.builder.nearAccount;
  const otherAccount = wo.payee.account !== wo.builder.nearAccount;
  return (
    <Card size="sm" aria-label="Key facts">
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <Fact
            label="Builder"
            value={<span title={name}>{name}</span>}
            detail={<span title={wo.builder.nearAccount}>{wo.builder.nearAccount}</span>}
          />
          <Fact
            label="Period"
            value={
              <span title={`${wo.periodStart} → ${wo.periodEnd}`} className="tabular-nums">
                {periodRange(wo.periodStart, wo.periodEnd)}
              </span>
            }
            detail={wo.periodStart.slice(0, 4)}
          />
          <Fact
            label="Budget"
            value={
              <span className="tabular-nums">
                {amount(wo.committedAmount)} of {amount(wo.budgetAmount)}
              </span>
            }
            detail={
              <span className="tabular-nums">
                {amount(wo.remainingAmount)} left · {amount(wo.paidAmount)} paid
              </span>
            }
          />
          <Fact
            label="Payout account"
            value={<PayoutAccount workOrder={wo} />}
            detail={
              otherAccount ? <span title={wo.payee.account}>{wo.payee.account}</span> : undefined
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}
