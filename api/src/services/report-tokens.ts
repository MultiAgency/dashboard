export type TokenAmount = { tokenId: string; amount: string };

export function sumByToken(rows: Array<{ tokenId: string; amount: string }>): TokenAmount[] {
  const map = new Map<string, bigint>();
  for (const row of rows) {
    map.set(row.tokenId, (map.get(row.tokenId) ?? 0n) + BigInt(row.amount));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tokenId, amount]) => ({ tokenId, amount: amount.toString() }));
}
