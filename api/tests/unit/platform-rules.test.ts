import { ASSETS } from "@multiagency/sdk";
import { describe, expect, test } from "vitest";
import { rulesChanges, type SignedPolicy } from "../../src/services/platform/rules";

const payoutTemplate: SignedPolicy = {
  frozen: false,
  actions: ["transfer"],
  confidential: true,
  owner_approval: true,
  assets: [ASSETS.USDC],
  limits: {
    per_transaction: { [ASSETS.USDC]: "25000000" },
    daily: { [ASSETS.USDC]: "50000000" },
    monthly: { [ASSETS.USDC]: "200000000" },
  },
  max_actions_per_hour: 10,
  destinations: { mode: "only", list: [] },
  budget: { daily_usd: "50", weekly_usd: null, monthly_usd: null },
  timelock_ms: 0,
};

const signedFor = (changes: Partial<SignedPolicy>): SignedPolicy => ({
  ...payoutTemplate,
  ...changes,
});

describe("payout rules on a platform agent", () => {
  test("a new agent paid in wNEAR: withdrawals to builders, wNEAR only, one cap, a monthly budget, no vote", () => {
    const { changes, summary } = rulesChanges(
      { asset: "wnear", maxPerPayout: "50", monthlyBudgetUsd: "500" },
      ["Carol.near", "dave.near", "carol.near"],
      payoutTemplate,
    );
    expect(changes).toEqual({
      withdrawals: [{ address: "carol.near" }, { address: "dave.near" }],
      assets: [ASSETS.wNEAR],
      limits: { per_transaction: { [ASSETS.wNEAR]: `50${"0".repeat(24)}` } },
      budget: { daily_usd: null, weekly_usd: null, monthly_usd: "500" },
      owner_approval: false,
    });
    expect(summary).toContain("Pay carol.near, dave.near by withdrawal to their NEAR account");
    expect(summary).toContain("Pay agreed builders within these limits without another signature");
  });

  test("a new agent paid in USDC: confidential transfers to builders and a USDC cap", () => {
    const { changes } = rulesChanges(
      { asset: "usdc", maxPerPayout: "12.5", monthlyBudgetUsd: "1000" },
      ["carol.near"],
      payoutTemplate,
    );
    expect(changes.destinations).toEqual([{ address: "carol.near", confidential: true }]);
    expect(changes.withdrawals).toBeUndefined();
    expect(changes.assets).toBeUndefined();
    expect(changes.limits).toEqual({ per_transaction: { [ASSETS.USDC]: "12500000" } });
  });

  test("rules already signed ask for nothing", () => {
    const signed = signedFor({
      actions: ["withdraw"],
      owner_approval: false,
      assets: [ASSETS.wNEAR],
      limits: { per_transaction: { [ASSETS.wNEAR]: `50${"0".repeat(24)}` } },
      destinations: {
        mode: "only",
        list: [{ action: "withdraw", chain: "near", address: "carol.near", memo: null }],
      },
      budget: { daily_usd: null, weekly_usd: null, monthly_usd: "500.00" },
    });
    expect(
      rulesChanges(
        { asset: "wnear", maxPerPayout: "50", monthlyBudgetUsd: "500" },
        ["carol.near"],
        signed,
      ),
    ).toEqual({ changes: {}, summary: [] });
  });

  test("a new builder changes only the payee list, and an ended one is removed", () => {
    const signed = signedFor({
      actions: ["withdraw"],
      owner_approval: false,
      assets: [ASSETS.wNEAR],
      limits: { per_transaction: { [ASSETS.wNEAR]: `50${"0".repeat(24)}` } },
      destinations: {
        mode: "only",
        list: [{ action: "withdraw", chain: "near", address: "carol.near", memo: null }],
      },
      budget: { daily_usd: null, weekly_usd: null, monthly_usd: "500" },
    });
    const { changes, summary } = rulesChanges(
      { asset: "wnear", maxPerPayout: "50", monthlyBudgetUsd: "500" },
      ["dave.near"],
      signed,
    );
    expect(changes).toEqual({ withdrawals: [{ address: "dave.near" }] });
    expect(summary).toEqual([
      "Pay dave.near by withdrawal to their NEAR account",
      "Stop paying carol.near by withdrawal to their NEAR account",
    ]);
  });

  test("switching from wNEAR to USDC moves the builders from withdrawals to transfers", () => {
    const signed = signedFor({
      actions: ["withdraw"],
      destinations: {
        mode: "only",
        list: [{ action: "withdraw", chain: "near", address: "carol.near", memo: null }],
      },
    });
    const { changes } = rulesChanges(
      { asset: "usdc", maxPerPayout: "25", monthlyBudgetUsd: "500" },
      ["carol.near"],
      signed,
    );
    expect(changes.withdrawals).toEqual([]);
    expect(changes.destinations).toEqual([{ address: "carol.near", confidential: true }]);
  });
});
