import type { Policy } from "@near-intents-agent-api/sdk";

export const NEAR_ASSET = "nep141:wrap.near";
export const NEAR_DECIMALS = 24;

export function nearToAtomic(near: string): string {
  const [whole = "0", fraction = ""] = near.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > NEAR_DECIMALS) {
    throw new Error(`${near} isn't a NEAR amount`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(NEAR_DECIMALS) +
    BigInt(fraction.padEnd(NEAR_DECIMALS, "0") || "0")
  ).toString();
}

export function atomicToNear(atomic: bigint, digits = 4): string {
  const unit = 10n ** BigInt(NEAR_DECIMALS);
  const scale = 10n ** BigInt(digits);
  const scaled = (atomic * scale) / unit;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function buildPolicy(input: {
  payees: string[];
  maxPayoutNear: string;
  monthlyBudgetUsd: string;
  frozen: boolean;
}): Policy {
  return {
    frozen: input.frozen,
    actions: ["withdraw"],
    confidential: false,
    owner_approval: false,
    assets: [NEAR_ASSET],
    limits: { per_transaction: { [NEAR_ASSET]: nearToAtomic(input.maxPayoutNear) } },
    max_actions_per_hour: 10,
    destinations: {
      mode: "only",
      list: [...new Set(input.payees.map((p) => p.toLowerCase()))]
        .sort()
        .map((address) => ({ action: "withdraw" as const, chain: "near", address, memo: null })),
    },
    budget: { daily_usd: null, weekly_usd: null, monthly_usd: input.monthlyBudgetUsd },
    timelock_ms: 0,
  };
}

export function payeesOf(policy: Policy): string[] {
  return policy.destinations.list
    .filter((d) => "chain" in d && d.action === "withdraw")
    .map((d) => d.address.toLowerCase());
}

export function allowsPayee(policy: Policy, payee: string): boolean {
  const listed = payeesOf(policy).includes(payee.toLowerCase());
  const { mode } = policy.destinations;
  return mode === "any" || (mode === "only" && listed) || (mode === "except" && !listed);
}

export function diffPolicy(signed: Policy, wanted: Policy): string[] {
  const out: string[] = [];
  const before = new Set(payeesOf(signed));
  const after = new Set(payeesOf(wanted));
  for (const payee of after) if (!before.has(payee)) out.push(`allow paying ${payee}`);
  for (const payee of before) if (!after.has(payee)) out.push(`stop paying ${payee}`);
  if (signed.destinations.mode !== wanted.destinations.mode) {
    out.push(`payees mode ${signed.destinations.mode} → ${wanted.destinations.mode}`);
  }
  const cap = (p: Policy) => p.limits.per_transaction?.[NEAR_ASSET] ?? null;
  if (cap(signed) !== cap(wanted)) out.push("change the maximum per payout");
  if ((signed.budget.monthly_usd ?? null) !== (wanted.budget.monthly_usd ?? null)) {
    out.push("change the monthly budget");
  }
  if (signed.owner_approval !== wanted.owner_approval) {
    out.push(
      wanted.owner_approval ? "require your vote per payout" : "pay automatically on approval",
    );
  }
  if (JSON.stringify(signed.assets) !== JSON.stringify(wanted.assets)) out.push("pay in NEAR");
  return out;
}
