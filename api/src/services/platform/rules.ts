import { displayToBaseUnits } from "../tokens";
import { type AppOwnerAction, ASSETS, type OwnerOutput } from "./client";
import type { PayoutAsset } from "./terms";

export type SignedPolicy = NonNullable<OwnerOutput<"overview">["policy"]["policy"]>;
export type PolicyChanges = Extract<AppOwnerAction, { type: "policy_update" }>["changes"];

export type PayoutRules = {
  asset: PayoutAsset;
  maxPerPayout: string;
  monthlyBudgetUsd: string;
};

export const PAYOUT_ASSET_TERMS = {
  wnear: { id: ASSETS.wNEAR, decimals: 24, symbol: "wNEAR" },
  usdc: { id: ASSETS.USDC, decimals: 6, symbol: "USDC" },
} as const satisfies Record<PayoutAsset, { id: string; decimals: number; symbol: string }>;

const sorted = (values: Iterable<string>) =>
  [...new Set([...values].map((v) => v.toLowerCase()))].sort();
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameUsd = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Number(a) === Number(b);

function payeeNotes(before: string[], after: string[], how: string) {
  const added = after.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !after.includes(p));
  return [
    ...(added.length ? [`Pay ${added.join(", ")} by ${how}`] : []),
    ...(removed.length ? [`Stop paying ${removed.join(", ")} by ${how}`] : []),
  ];
}

export function rulesChanges(
  rules: PayoutRules,
  payees: string[],
  signed: SignedPolicy,
): { changes: PolicyChanges; summary: string[] } {
  const asset = PAYOUT_ASSET_TERMS[rules.asset];
  const changes: PolicyChanges = {};
  const summary: string[] = [];
  const wanted = sorted(payees);

  const withdrawals = sorted(
    signed.destinations.list.flatMap((d) =>
      d.action === "withdraw" && d.chain === "near" ? [d.address] : [],
    ),
  );
  const wantedWithdrawals = rules.asset === "wnear" ? wanted : [];
  if (!sameList(withdrawals, wantedWithdrawals)) {
    changes.withdrawals = wantedWithdrawals.map((address) => ({ address }));
    summary.push(...payeeNotes(withdrawals, wantedWithdrawals, "withdrawal to their NEAR account"));
  }

  const transfers = signed.destinations.list.flatMap((d) => (d.action === "transfer" ? [d] : []));
  const wantedTransfers = rules.asset === "usdc" ? wanted : [];
  if (
    !sameList(sorted(transfers.map((d) => d.address)), wantedTransfers) ||
    transfers.some((d) => !d.confidential)
  ) {
    changes.destinations = wantedTransfers.map((address) => ({ address, confidential: true }));
    summary.push(
      ...payeeNotes(
        sorted(transfers.map((d) => d.address)),
        wantedTransfers,
        "confidential transfer",
      ),
    );
  }

  if (signed.assets === "any" || !sameList(sorted(signed.assets), [asset.id])) {
    changes.assets = [asset.id];
    summary.push(`Spend only ${asset.symbol}`);
  }

  const cap = displayToBaseUnits(rules.maxPerPayout, asset.decimals).toString();
  const limits = signed.limits;
  const capOnly =
    Object.keys(limits).every((period) => period === "per_transaction") &&
    sameList(Object.keys(limits.per_transaction ?? {}), [asset.id]) &&
    limits.per_transaction?.[asset.id] === cap;
  if (!capOnly) {
    changes.limits = { per_transaction: { [asset.id]: cap } };
    summary.push(
      `At most ${rules.maxPerPayout} ${asset.symbol} per payout, with no other per-asset limits`,
    );
  }

  const budget = signed.budget;
  if (
    !sameUsd(budget.daily_usd, null) ||
    !sameUsd(budget.weekly_usd, null) ||
    !sameUsd(budget.monthly_usd, rules.monthlyBudgetUsd)
  ) {
    changes.budget = { daily_usd: null, weekly_usd: null, monthly_usd: rules.monthlyBudgetUsd };
    summary.push(`A monthly budget of $${rules.monthlyBudgetUsd}, with no daily or weekly budget`);
  }

  if (signed.owner_approval) {
    changes.owner_approval = false;
    summary.push("Pay agreed builders within these limits without another signature");
  }

  return { changes, summary };
}
