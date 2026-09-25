import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Empty } from "@/components/admin-form";
import { StatCard } from "@/components/budget";
import { TokenAmountCell } from "@/components/token-amounts";
import { formatTokenAmount } from "@/lib/format-amount";
import { tokenDisplayName } from "@/lib/report-amounts";

type BillingRow = {
  tokenId: string;
  amount: string;
  status: string;
  createdAt: string | Date;
  proposalId: string;
};

type BuilderSummaryPanelProps = {
  billings: BillingRow[];
  projectCount: number;
};

type TokenTotalRow = {
  tokenId: string;
  tokenLabel: string;
  approvedAmount: string;
  approvedCount: number;
  pendingAmount: string;
  pendingCount: number;
};

function buildTokenTotals(billings: BillingRow[]): TokenTotalRow[] {
  const byToken = new Map<
    string,
    { approved: bigint; approvedCount: number; pending: bigint; pendingCount: number }
  >();

  for (const billing of billings) {
    try {
      const amount = BigInt(billing.amount);
      const existing = byToken.get(billing.tokenId) ?? {
        approved: 0n,
        approvedCount: 0,
        pending: 0n,
        pendingCount: 0,
      };
      if (billing.status === "Approved") {
        existing.approved += amount;
        existing.approvedCount += 1;
      } else {
        existing.pending += amount;
        existing.pendingCount += 1;
      }
      byToken.set(billing.tokenId, existing);
    } catch {}
  }

  return [...byToken.entries()]
    .sort(([a], [b]) => tokenDisplayName(a).localeCompare(tokenDisplayName(b)))
    .map(([tokenId, totals]) => ({
      tokenId,
      tokenLabel: tokenDisplayName(tokenId),
      approvedAmount: totals.approved.toString(),
      approvedCount: totals.approvedCount,
      pendingAmount: totals.pending.toString(),
      pendingCount: totals.pendingCount,
    }));
}

export function BuilderSummaryPanel({ billings, projectCount }: BuilderSummaryPanelProps) {
  const tokenTotals = useMemo(() => buildTokenTotals(billings), [billings]);
  const approvedCount = useMemo(
    () => billings.filter((b) => b.status === "Approved").length,
    [billings],
  );
  const pendingCount = billings.length - approvedCount;
  const paymentHistory = useMemo(
    () =>
      [...billings]
        .filter((b) => b.status === "Approved")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [billings],
  );

  const hasOutstanding = tokenTotals.some((row) => row.pendingCount > 0);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="payment-summary-title">
      <h2 id="payment-summary-title" className="font-heading text-lg font-semibold">
        Payment summary
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Billing entries" value={billings.length} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Outstanding" value={pendingCount} />
        <StatCard label="Projects" value={projectCount} />
      </div>

      {tokenTotals.length === 0 ? (
        <Empty label="No billings yet" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Totals by token</h3>
            </CardTitle>
            {hasOutstanding && (
              <CardDescription>
                Outstanding amounts are billings not yet approved on-chain.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Token</TableHead>
                  <TableHead scope="col">Approved</TableHead>
                  <TableHead scope="col">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokenTotals.map((row) => (
                  <TableRow key={row.tokenId}>
                    <TableCell className="font-medium" title={row.tokenId}>
                      {row.tokenLabel}
                    </TableCell>
                    <TableCell>
                      {row.approvedCount > 0 ? (
                        <TokenAmountCell amount={row.approvedAmount} tokenId={row.tokenId} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.pendingCount > 0 ? (
                        <TokenAmountCell amount={row.pendingAmount} tokenId={row.tokenId} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {paymentHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Recent payments</h3>
            </CardTitle>
            <CardDescription>The last ten approved billings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col">Proposal</TableHead>
                  <TableHead scope="col" className="text-right">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentHistory.map((row) => (
                  <TableRow key={row.proposalId}>
                    <TableCell className="tabular-nums">
                      {new Date(row.createdAt).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="tabular-nums">#{row.proposalId}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTokenAmount(row.amount, row.tokenId)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
