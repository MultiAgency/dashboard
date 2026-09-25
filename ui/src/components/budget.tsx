import { Card, CardContent } from "@/components/ui/card";
import type { ApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

type ProjectBudget = Awaited<ReturnType<ApiClient["agency"]["projects"]["getBudget"]>>;
type TokenBudget = ProjectBudget["budgets"][number];
type PayingDaoSpend = ProjectBudget["subcontractorSpend"][number];

export function Budget({ budget }: { budget: TokenBudget }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
        {budget.tokenId}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="budget" value={formatTokenAmount(budget.budget, budget.tokenId)} />
        <Tile label="allocated" value={formatTokenAmount(budget.allocated, budget.tokenId)} />
        <Tile label="committed" value={formatTokenAmount(budget.committed, budget.tokenId)} />
        <Tile label="paid" value={formatTokenAmount(budget.paid, budget.tokenId)} />
        <Tile label="remaining" value={formatTokenAmount(budget.remaining, budget.tokenId)} />
      </div>
    </div>
  );
}

export function SubcontractorSpend({ rows, title }: { rows: PayingDaoSpend[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-mono">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={`${row.daoAccountId}/${row.tokenId}`}>
            <CardContent className="p-4 space-y-1">
              <div className="font-mono text-xs text-muted-foreground break-all">
                {row.daoAccountId}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span>paid {formatTokenAmount(row.paid, row.tokenId)}</span>
                <span className="text-muted-foreground">
                  committed {formatTokenAmount(row.committed, row.tokenId)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const isNegative = value.trim().startsWith("-");
  return (
    <Card className={isNegative ? "border-destructive/60" : undefined}>
      <CardContent className="p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`font-display text-lg uppercase tracking-tight font-extrabold tabular-nums break-all ${
            isNegative ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
