import { Card, CardContent } from "@/components/ui/card";
import type { ApiClient } from "@/lib/api-client";
import { formatTokenAmount } from "@/lib/format-amount";

type TokenBudget = Awaited<ReturnType<ApiClient["projects"]["getBudget"]>>["budgets"][number];

export function Budget({ budget }: { budget: TokenBudget }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
        {budget.tokenId}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="budget" value={formatTokenAmount(budget.budget, budget.tokenId)} />
        <Tile label="allocated" value={formatTokenAmount(budget.allocated, budget.tokenId)} />
        <Tile label="paid" value={formatTokenAmount(budget.paid, budget.tokenId)} />
        <Tile label="remaining" value={formatTokenAmount(budget.remaining, budget.tokenId)} />
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
          className={`text-lg font-semibold tracking-tight break-all ${
            isNegative ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
