import { parseDecimalToBase } from "@/lib/format-amount";

export type ChangeOrderItemKind = "plan_change" | "one_off_move";

export type ChangeOrderItem = {
  projectId: string | null;
  tokenId: string;
  kind: ChangeOrderItemKind;
  amount: string;
};

export type PlanLine = { projectId: string; tokenId: string; amount: string };

const keyOf = (line: { projectId: string; tokenId: string }) =>
  `${line.projectId}\u0000${line.tokenId}`;

export function planChangeItems(current: PlanLine[], edited: PlanLine[]): ChangeOrderItem[] {
  const before = new Map(current.map((l) => [keyOf(l), BigInt(l.amount || "0")]));
  const after = new Map(edited.map((l) => [keyOf(l), BigInt(l.amount || "0")]));
  const lines = [...edited, ...current.filter((l) => !after.has(keyOf(l)))];
  const seen = new Set<string>();
  const items: ChangeOrderItem[] = [];
  for (const line of lines) {
    const key = keyOf(line);
    if (seen.has(key)) continue;
    seen.add(key);
    const delta = (after.get(key) ?? 0n) - (before.get(key) ?? 0n);
    if (delta !== 0n) {
      items.push({
        projectId: line.projectId,
        tokenId: line.tokenId,
        kind: "plan_change",
        amount: delta.toString(),
      });
    }
  }
  return items;
}

export function prepaidBalanceLegs(moves: ChangeOrderItem[]): ChangeOrderItem[] {
  const net = new Map<string, bigint>();
  for (const move of moves) {
    if (move.kind !== "one_off_move" || move.projectId === null) continue;
    net.set(move.tokenId, (net.get(move.tokenId) ?? 0n) + BigInt(move.amount));
  }
  return [...net.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([tokenId, amount]) => ({
      projectId: null,
      tokenId,
      kind: "one_off_move" as const,
      amount: (-amount).toString(),
    }));
}

export function signedBaseAmount(
  input: string,
  decimals: number | undefined,
): { value: string; error: string } {
  const trimmed = input.trim();
  if (trimmed === "") return { value: "", error: "" };
  const negative = trimmed.startsWith("-");
  const magnitude = negative ? trimmed.slice(1) : trimmed;
  let base: string;
  if (decimals === undefined) {
    if (!/^\d+$/.test(magnitude)) {
      return { value: "", error: "Enter a whole number in the token's smallest unit." };
    }
    base = magnitude.replace(/^0+(?=\d)/, "");
  } else {
    try {
      base = parseDecimalToBase(magnitude, decimals);
    } catch (e) {
      return { value: "", error: (e as Error).message };
    }
  }
  if (/^0+$/.test(base)) return { value: "", error: "An amount cannot be zero." };
  return { value: negative ? `-${base}` : base, error: "" };
}

const FAILURE_MESSAGES: Record<string, string> = {
  PREPAID_BALANCE_EXCEEDED: "The Prepaid balance did not cover it when it was applied.",
  ATTRIBUTED_BUDGET_EXCEEDED: "It pulled back more than this Engagement put into the Project.",
  REMAINING_EXCEEDED:
    "It pulled back budget that is already Allocated, Committed or Paid on the Project.",
  BUDGET_INSUFFICIENT: "The Project's budget would have gone below zero.",
  PLAN_BELOW_ZERO: "The Allocation plan for a Project would have gone below zero.",
  NOT_SHARED: "A Project in it is no longer shared through this Engagement.",
  NOT_ACTIVE: "The Engagement is no longer active.",
  NO_AGENCY_DAO: "The Agency has no Agency DAO to fund Budget entries from.",
};

export function failureMessage(reason: string): string {
  return FAILURE_MESSAGES[reason] ?? reason;
}

export function awaitingCountFor(
  awaiting: readonly { engagementId: string; canDecide: boolean }[],
  engagementId: string,
): number {
  return awaiting.filter((c) => c.canDecide && c.engagementId === engagementId).length;
}

export function awaitingLink(changeOrder: {
  engagementId: string;
  proposedBy: { side: "agency" | "client" };
}): string {
  return changeOrder.proposedBy.side === "agency"
    ? `/client/${changeOrder.engagementId}/plan`
    : `/admin/engagements/${changeOrder.engagementId}?tab=plan`;
}
