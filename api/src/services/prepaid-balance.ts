import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { budgets, type EngagementRow, engagements, prepayments } from "../db/schema";

export type PrepaidBalance = {
  tokenId: string;
  prepaid: string;
  budgeted: string;
  balance: string;
};

export async function lockEngagement(
  tx: Database,
  engagementId: string,
): Promise<EngagementRow | null> {
  const [row] = await tx
    .select()
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .for("update");
  return row ?? null;
}

async function sumsByToken(
  db: Database,
  table: typeof prepayments | typeof budgets,
  engagementId: string,
): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ tokenId: table.tokenId, amount: table.amount })
    .from(table)
    .where(eq(table.engagementId, engagementId));
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    sums.set(row.tokenId, (sums.get(row.tokenId) ?? 0n) + BigInt(row.amount));
  }
  return sums;
}

export async function prepaidBalanceRows(
  db: Database,
  engagementId: string,
): Promise<PrepaidBalance[]> {
  const [prepaid, budgeted] = await Promise.all([
    sumsByToken(db, prepayments, engagementId),
    sumsByToken(db, budgets, engagementId),
  ]);
  return [...new Set([...prepaid.keys(), ...budgeted.keys()])].sort().map((tokenId) => {
    const p = prepaid.get(tokenId) ?? 0n;
    const b = budgeted.get(tokenId) ?? 0n;
    return {
      tokenId,
      prepaid: p.toString(),
      budgeted: b.toString(),
      balance: (p - b).toString(),
    };
  });
}

export async function prepaidBalances(
  db: Database,
  engagementId: string,
): Promise<Map<string, bigint>> {
  const rows = await prepaidBalanceRows(db, engagementId);
  return new Map(rows.map((row) => [row.tokenId, BigInt(row.balance)]));
}
