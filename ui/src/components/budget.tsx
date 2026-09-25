import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { cn } from "@/lib/utils";

type ProjectBudget = Awaited<ReturnType<ApiClient["agency"]["projects"]["getBudget"]>>;
type TokenBudget = ProjectBudget["budgets"][number];
type PayingDaoSpend = ProjectBudget["subcontractorSpend"][number];

export function StatCard({
  label,
  value,
  hint,
  negative = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  negative?: boolean;
}) {
  return (
    <Card size="sm" variant={negative ? "destructive" : "default"}>
      <CardContent className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "font-heading text-lg font-semibold tabular-nums break-words",
            negative && "text-destructive",
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Budget({ budget }: { budget: TokenBudget }) {
  const tiles = [
    { label: "Budget", value: budget.budget },
    { label: "Allocated", value: budget.allocated },
    { label: "Committed", value: budget.committed },
    { label: "Paid", value: budget.paid },
    { label: "Remaining", value: budget.remaining },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Badge variant="outline">{budget.tokenId}</Badge>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const formatted = formatTokenAmount(tile.value, budget.tokenId);
          return (
            <StatCard
              key={tile.label}
              label={tile.label}
              value={formatted}
              negative={formatted.trim().startsWith("-")}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SubcontractorSpend({ rows, title }: { rows: PayingDaoSpend[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={`${row.daoAccountId}/${row.tokenId}`} size="sm">
            <CardContent className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground break-all">{row.daoAccountId}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span>Paid {formatTokenAmount(row.paid, row.tokenId)}</span>
                <span className="text-muted-foreground">
                  Committed {formatTokenAmount(row.committed, row.tokenId)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
