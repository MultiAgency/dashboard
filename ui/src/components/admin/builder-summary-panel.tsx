import { useMemo } from "react";
import { Card, CardContent } from "@/components";
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

const SECTION_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground px-3 py-2 text-left border-b border-border";
const CELL = "px-3 py-2 text-sm border-b border-border";

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
    } catch {
      // skip non-numeric amounts
    }
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
    <section className="space-y-3">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        payment summary
      </h2>

      <dl className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">Billing entries</dt>
            <dd className="font-display text-2xl font-black">{billings.length}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">Approved</dt>
            <dd className="font-display text-2xl font-black">{approvedCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">Outstanding</dt>
            <dd className="font-display text-2xl font-black">{pendingCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">Projects</dt>
            <dd className="font-display text-2xl font-black">{projectCount}</dd>
          </CardContent>
        </Card>
      </dl>

      {tokenTotals.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-6 text-sm text-muted-foreground text-center">
            No billings yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-medium">Totals by token</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={SECTION_LABEL}>
                      Token
                    </th>
                    <th scope="col" className={SECTION_LABEL}>
                      Approved
                    </th>
                    <th scope="col" className={SECTION_LABEL}>
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tokenTotals.map((row) => (
                    <tr key={row.tokenId} className="hover:bg-muted/20">
                      <td className={CELL}>
                        <span className="font-medium" title={row.tokenId}>
                          {row.tokenLabel}
                        </span>
                      </td>
                      <td className={CELL}>
                        {row.approvedCount > 0 ? (
                          <TokenAmountCell amount={row.approvedAmount} tokenId={row.tokenId} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={CELL}>
                        {row.pendingCount > 0 ? (
                          <TokenAmountCell amount={row.pendingAmount} tokenId={row.tokenId} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {hasOutstanding && (
        <p className="text-xs text-muted-foreground">
          Outstanding amounts are billings not yet approved on-chain.
        </p>
      )}

      {paymentHistory.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-medium">Payment history</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={SECTION_LABEL}>
                      Date
                    </th>
                    <th scope="col" className={SECTION_LABEL}>
                      Proposal
                    </th>
                    <th scope="col" className={SECTION_LABEL}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((row) => (
                    <tr key={row.proposalId} className="hover:bg-muted/20">
                      <td className={`${CELL} font-mono text-xs`}>
                        {new Date(row.createdAt).toISOString().slice(0, 10)}
                      </td>
                      <td className={`${CELL} font-mono text-xs`}>#{row.proposalId}</td>
                      <td className={CELL}>
                        <span className="font-mono text-sm">
                          {formatTokenAmount(row.amount, row.tokenId)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
