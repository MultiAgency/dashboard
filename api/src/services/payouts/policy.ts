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

export const WNEAR_STORAGE = 1_250_000_000_000_000_000_000n;
const TOP_UP_ACTION_GAS = "15000000000000";

export function topUpProposal(input: {
  daoAccountId: string;
  depositAddress: string;
  memo: string | null;
  amount: bigint;
  amountNear: string;
}) {
  const wnear = NEAR_ASSET.slice("nep141:".length);
  const call = (method_name: string, args: Record<string, unknown>, deposit: bigint) => ({
    method_name,
    args: Buffer.from(JSON.stringify(args)).toString("base64"),
    deposit: deposit.toString(),
    gas: TOP_UP_ACTION_GAS,
  });
  return {
    description: `Top up the MultiAgency payout agent with ${input.amountNear} NEAR, wrapped as wNEAR (plus up to 0.0025 NEAR of wNEAR storage, refunded where already registered)`,
    kind: {
      FunctionCall: {
        receiver_id: wnear,
        actions: [
          call(
            "storage_deposit",
            { account_id: input.daoAccountId, registration_only: true },
            WNEAR_STORAGE,
          ),
          call("near_deposit", {}, input.amount),
          call(
            "storage_deposit",
            { account_id: input.depositAddress, registration_only: true },
            WNEAR_STORAGE,
          ),
          call(
            "ft_transfer",
            {
              receiver_id: input.depositAddress,
              amount: input.amount.toString(),
              ...(input.memo ? { memo: input.memo } : {}),
            },
            1n,
          ),
        ],
      },
    },
  };
}

export function topUpFor(needed: bigint, balance: bigint): bigint {
  const step = 10n ** BigInt(NEAR_DECIMALS - 2);
  const missing = needed > balance ? needed - balance : 0n;
  return ((missing + step - 1n) / step) * step;
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
