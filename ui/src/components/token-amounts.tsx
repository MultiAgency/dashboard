import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";

type TokenAmountCellProps = {
  amount?: string;
  tokenId: string;
};

/** Single formatted amount for table cells. */
export function TokenAmountCell({ amount, tokenId }: TokenAmountCellProps) {
  if (!amount) {
    return <span className="text-muted-foreground">—</span>;
  }

  const known = tokenSymbol(tokenId) !== tokenId;
  const formatted = formatTokenAmount(amount, tokenId);

  return (
    <span
      className="font-mono text-xs whitespace-nowrap"
      title={known ? tokenId : `${amount} base units\n${tokenId}`}
    >
      {formatted}
    </span>
  );
}
