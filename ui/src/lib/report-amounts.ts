import { formatTokenAmount, tokenSymbol } from "@/lib/format-amount";

export type TokenAmount = { tokenId: string; amount: string };

export function filterNonzeroTokenAmounts(totals: TokenAmount[]): TokenAmount[] {
  return totals.filter((t) => {
    try {
      return BigInt(t.amount) !== 0n;
    } catch {
      return true;
    }
  });
}

export function formatTokenTotals(totals: TokenAmount[]): string {
  const nonzero = filterNonzeroTokenAmounts(totals);
  if (nonzero.length === 0) return "—";
  return nonzero.map((t) => formatTokenAmount(t.amount, t.tokenId)).join(" · ");
}

export function formatAllocatedSpent(
  budgetByToken: TokenAmount[],
  spentByToken: TokenAmount[],
): string {
  return `allocated: ${formatTokenTotals(budgetByToken)}, spent: ${formatTokenTotals(spentByToken)}`;
}

/** Short label for tooltips / secondary text (truncates long FT contract ids). */
export function tokenDisplayName(tokenId: string): string {
  const symbol = tokenSymbol(tokenId);
  if (symbol !== tokenId) return symbol;
  if (tokenId.length <= 24) return tokenId;
  return `${tokenId.slice(0, 10)}…${tokenId.slice(-10)}`;
}

/** Unique token ids across report sections, sorted by display name. */
export function collectReportTokenIds(...groups: TokenAmount[][]): string[] {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const t of group) ids.add(t.tokenId);
  }
  return [...ids].sort((a, b) => tokenDisplayName(a).localeCompare(tokenDisplayName(b)));
}

export function getTokenAmount(amounts: TokenAmount[], tokenId: string): string | undefined {
  const row = amounts.find((t) => t.tokenId === tokenId);
  if (!row) return undefined;
  try {
    if (BigInt(row.amount) === 0n) return undefined;
  } catch {
    // keep non-numeric amounts
  }
  return row.amount;
}
