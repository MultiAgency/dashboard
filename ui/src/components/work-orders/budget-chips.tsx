import { Button } from "@/components";
import { formatTokenAmount } from "@/lib/format-amount";
import type { BudgetChoice } from "@/lib/work-order-defaults";

export function BudgetChips({
  choices,
  onPick,
}: {
  choices: BudgetChoice[];
  onPick: (choice: BudgetChoice) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">Recent budgets</legend>
      <span className="text-xs text-muted-foreground">Recent:</span>
      {choices.map((choice) => (
        <Button
          key={`${choice.tokenId}:${choice.budgetAmount}`}
          type="button"
          size="xs"
          variant="outline"
          onClick={() => onPick(choice)}
        >
          {formatTokenAmount(choice.budgetAmount, choice.tokenId)}
        </Button>
      ))}
    </fieldset>
  );
}
