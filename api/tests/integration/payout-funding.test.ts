import { generateKey, generateNonce, verifyNep413Signature } from "near-kit";
import { beforeEach, describe, expect, test } from "vitest";
import { nearToAtomic } from "../../src/services/payouts/policy";
import { createPayoutAgents, type PayoutAgents } from "../../src/services/payouts/service";
import {
  createOwnerSigner,
  type OwnerIntent,
  type OwnerSigner,
  ownerSignerFrom,
} from "../../src/services/payouts/signer";
import { FakeAgentApi } from "../fakes/agent-api";
import { migratedDatabase } from "./_pg";

const ORG = "studio";
const CAROL = "carol.near";
const DAVE = "dave.near";
const NEAR = 10n ** 24n;

class FakeSigner implements OwnerSigner {
  publicKey = "ed25519:owner";
  signed: { accountId: string; signerPublicKey: string | null; intent: OwnerIntent }[] = [];

  async sign(accountId: string, signerPublicKey: string | null, intent: OwnerIntent) {
    this.signed.push({ accountId, signerPublicKey, intent });
    return intent.standard === "nep413"
      ? { ...intent, public_key: this.publicKey, signature: "server-sig" }
      : { ...intent, signed_delegate: "server-delegate" };
  }
}

describe("payout funding and automatic payee rules", () => {
  const database = migratedDatabase({ perTest: true });
  let agent: FakeAgentApi;
  let clock: Date;
  let payees: string[];
  let ownerKeys: string[];
  let signer: FakeSigner;

  beforeEach(() => {
    agent = new FakeAgentApi();
    clock = new Date("2026-09-20T12:00:00.000Z");
    payees = [CAROL];
    ownerKeys = ["ed25519:owner"];
    signer = new FakeSigner();
  });

  function payoutsWith(options: { serverKey: boolean }): PayoutAgents {
    return createPayoutAgents({
      db: database.db,
      api: agent,
      secretKey: "test-secret",
      payees: async () => payees,
      fullAccessKeys: async () => ownerKeys,
      ownerSigner: options.serverKey ? signer : null,
      now: () => clock,
    });
  }

  async function setUp(payouts: PayoutAgents, options: { grant?: boolean } = {}) {
    await payouts.saveSettings(ORG, "studio-admin", {
      ownerAccountId: "rita.near",
      monthlyBudgetUsd: "5000",
      maxPayoutNear: "500",
    });
    const create = await payouts.prepare(ORG, {
      action: "create_agent",
      publicKey: `ed25519:${"1".repeat(44)}`,
    });
    await payouts.submit(ORG, {
      correlationId: create.correlationId,
      signedData: { ...create.intent, signed_delegate: "signed" },
    });
    if (options.grant === false) return;
    const grant = await payouts.prepare(ORG, { action: "issue_grant" });
    await payouts.submit(ORG, {
      correlationId: grant.correlationId,
      signedData: { ...grant.intent, public_key: "ed25519:owner", signature: "sig" },
    });
  }

  async function walletFreeze(payouts: PayoutAgents) {
    const freeze = await payouts.prepare(ORG, { action: "freeze" });
    await payouts.submit(ORG, {
      correlationId: freeze.correlationId,
      signedData: { ...freeze.intent, signed_delegate: "signed" },
    });
  }

  describe("ensurePayees", () => {
    test("with the owner's key on the server, a new builder is allowed without a wallet", async () => {
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      expect((await payouts.view(ORG)).serverSigning).toEqual({
        configured: true,
        active: true,
        warning: null,
      });
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: true,
        reason: null,
        needsSignature: false,
      });
      expect(signer.signed).toEqual([]);

      payees = [CAROL, DAVE];
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: true,
        reason: null,
        needsSignature: false,
      });
      expect(signer.signed).toHaveLength(1);
      expect(signer.signed[0]).toMatchObject({
        accountId: "rita.near",
        signerPublicKey: "ed25519:owner",
        intent: { standard: "nep413" },
      });
      expect(agent.generated.at(-1)).toMatchObject({
        type: "policy_update",
        expected_revision: 1,
      });
      expect(agent.policy?.destinations.list.map((d) => d.address)).toEqual([CAROL, DAVE]);
      expect((await payouts.view(ORG)).changes).toEqual([]);
      expect(await payouts.readiness(ORG, DAVE)).toEqual({ ready: true, code: null, reason: null });
    });

    test("without a server key, the owner is asked to sign the rules for the new builder", async () => {
      const payouts = payoutsWith({ serverKey: false });
      await setUp(payouts);
      payees = [CAROL, DAVE];
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: false,
        reason: `Sign the updated rules to allow paying ${DAVE}`,
        needsSignature: true,
      });
      expect((await payouts.view(ORG)).serverSigning).toEqual({
        configured: false,
        active: false,
        warning: null,
      });
      expect(agent.generated.some((g) => g.type === "policy_update")).toBe(false);
    });

    test("a server key that isn't the owner's is never used, and the card says so", async () => {
      ownerKeys = ["ed25519:someone-else"];
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      const view = await payouts.view(ORG);
      expect(view.serverSigning.active).toBe(false);
      expect(view.serverSigning.warning).toContain("isn't a full-access key of rita.near");
      payees = [CAROL, DAVE];
      expect(await payouts.ensurePayees(ORG)).toMatchObject({ ok: false, needsSignature: true });
      await expect(payouts.signOnServer(ORG, "sync_policy")).rejects.toThrow(
        "isn't a full-access key",
      );
      expect(signer.signed).toEqual([]);
    });

    test("during the rules cooldown it waits and succeeds on a later retry", async () => {
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      payees = [CAROL, DAVE];
      agent.policyChangeAvailableAt = "2026-09-20T14:30:00.000Z";
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: false,
        reason: "Rules can change again at 2026-09-20 14:30 UTC",
        needsSignature: false,
      });
      expect(signer.signed).toEqual([]);
      clock = new Date("2026-09-20T14:31:00.000Z");
      expect((await payouts.ensurePayees(ORG)).ok).toBe(true);
      expect(signer.signed).toHaveLength(1);
    });

    test("the server never signs actions that move or unlock funds", async () => {
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      for (const action of ["freeze", "unfreeze", "create_agent"]) {
        await expect(payouts.signOnServer(ORG, action as never)).rejects.toThrow(
          "Only the owner's wallet can sign that",
        );
      }
      expect(signer.signed).toEqual([]);
    });
  });

  describe("grant renewal", () => {
    test("with a server key the permission is renewed when it has under 14 days left", async () => {
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      expect(await payouts.renewGrant(ORG)).toEqual({ renewed: false, reason: null });
      clock = new Date("2026-12-10T12:00:00.000Z");
      expect((await payouts.view(ORG)).grantExpiringSoon).toBe(true);
      expect(await payouts.renewGrant(ORG)).toEqual({ renewed: true, reason: null });
      const view = await payouts.view(ORG);
      expect(view.grantExpiringSoon).toBe(false);
      expect(view.grantExpiresAt).toBe("2027-03-10T12:00:00.000Z");
      expect(signer.signed.at(-1)?.intent.standard).toBe("nep413");
    });

    test("without a server key the owner is told when the permission expires", async () => {
      const payouts = payoutsWith({ serverKey: false });
      await setUp(payouts);
      clock = new Date("2026-12-10T12:00:00.000Z");
      expect(await payouts.renewGrant(ORG)).toEqual({
        renewed: false,
        reason: "MultiAgency's payout permission expires 2026-12-19: renew it with your wallet",
      });
    });
  });

  describe("readiness", () => {
    test("each blocker has its own code", async () => {
      const payouts = payoutsWith({ serverKey: false });
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ ready: false, code: "no_agent" });
      await setUp(payouts, { grant: false });
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ ready: false, code: "no_grant" });
      const grant = await payouts.prepare(ORG, { action: "issue_grant" });
      await payouts.submit(ORG, {
        correlationId: grant.correlationId,
        signedData: { ...grant.intent, public_key: "ed25519:owner", signature: "sig" },
      });
      expect(await payouts.readiness(ORG, CAROL)).toEqual({
        ready: true,
        code: null,
        reason: null,
      });
      expect(await payouts.readiness(ORG, DAVE)).toMatchObject({
        ready: false,
        code: "payee_not_allowed",
      });

      expect(await payouts.readiness(ORG, CAROL, nearToAtomic("600"))).toEqual({
        ready: false,
        code: "over_cap",
        reason: "600 NEAR is over the 500 NEAR cap per payout",
      });

      expect(await payouts.readiness(ORG, CAROL, nearToAtomic("1"))).toEqual({
        ready: false,
        code: "insufficient_balance",
        reason: "The agent holds 0 NEAR; this payout needs 1 NEAR",
      });

      agent.balanceRaw = (100n * NEAR).toString();
      expect(await payouts.readiness(ORG, CAROL, nearToAtomic("10"))).toEqual({
        ready: true,
        code: null,
        reason: null,
      });

      agent.monthlySpentUsd = "4990";
      agent.monthlyResetsAt = "2026-10-19T12:00:00.000Z";
      expect(await payouts.readiness(ORG, CAROL, nearToAtomic("10"))).toEqual({
        ready: false,
        code: "over_monthly_budget",
        reason: "≈$20.00 is more than the $10.00 left in this month's budget (resets 2026-10-19)",
      });
      expect(await payouts.readiness(ORG, CAROL, nearToAtomic("10"), "0.5")).toMatchObject({
        ready: true,
      });

      agent.policy = agent.policy && { ...agent.policy, owner_approval: true };
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "owner_approval" });
      agent.policy = agent.policy && { ...agent.policy, owner_approval: false };

      await walletFreeze(payouts);
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ ready: false, code: "frozen" });
    });

    test("rules that aren't applied yet block payouts", async () => {
      const payouts = payoutsWith({ serverKey: false });
      await setUp(payouts);
      agent.policy = null;
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "not_applied" });
    });
  });

  describe("fundingCheck", () => {
    test("reports the shortfall rounded up and whether the monthly budget covers the need", async () => {
      const payouts = payoutsWith({ serverKey: false });
      expect(await payouts.fundingCheck(ORG, { near: NEAR, priceUsd: "4" })).toBeNull();
      await setUp(payouts);
      agent.balanceRaw = (10n * NEAR).toString();
      const needs = { near: 25n * NEAR + 5n * 10n ** 21n, priceUsd: "4" };
      expect(await payouts.fundingCheck(ORG, needs)).toEqual({
        balanceNear: "10",
        neededNear: "25.005",
        shortfallNear: "15.01",
        monthlyBudgetUsd: "5000",
        monthlyNeededUsd: "100.02",
        suggestedBudgetUsd: null,
        budgetTooLow: false,
        lowBalance: true,
      });

      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "50",
        maxPayoutNear: "500",
      });
      const sync = await payouts.prepare(ORG, { action: "sync_policy" });
      await payouts.submit(ORG, {
        correlationId: sync.correlationId,
        signedData: { ...sync.intent, public_key: "ed25519:owner", signature: "sig" },
      });
      agent.balanceRaw = (30n * NEAR).toString();
      expect(await payouts.fundingCheck(ORG, needs)).toMatchObject({
        shortfallNear: "0",
        monthlyBudgetUsd: "50",
        monthlyNeededUsd: "100.02",
        suggestedBudgetUsd: "101",
        budgetTooLow: true,
        lowBalance: false,
      });
    });

    test("falls back to the agent's NEAR price when no price is given", async () => {
      const payouts = payoutsWith({ serverKey: false });
      await setUp(payouts);
      expect(await payouts.fundingCheck(ORG, { near: 3n * NEAR, priceUsd: null })).toMatchObject({
        monthlyNeededUsd: "6.00",
        shortfallNear: "3",
      });
    });

    test("raising the budget is applied by the server when it holds the owner's key", async () => {
      const payouts = payoutsWith({ serverKey: true });
      await setUp(payouts);
      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "9000",
        maxPayoutNear: "500",
      });
      expect((await payouts.ensurePayees(ORG)).ok).toBe(true);
      expect(agent.policy?.budget.monthly_usd).toBe("9000");
      const view = await payouts.view(ORG);
      expect(view.policy).toMatchObject({ monthlyLimitUsd: "9000", monthlyResetsAt: null });
    });
  });

  describe("the server's owner signer", () => {
    test("signs NEP-413 rule updates with the owner's key in the format the Agent API takes", async () => {
      const key = generateKey();
      const real = createOwnerSigner(key.secretKey);
      expect(real.publicKey).toBe(key.publicKey.toString());
      const nonce = generateNonce();
      const intent = {
        standard: "nep413",
        payload: {
          message: "update the rules",
          recipient: "intents.near",
          nonce: Buffer.from(nonce).toString("base64"),
        },
      };
      const signed = await real.sign("rita.near", real.publicKey, intent);
      expect(signed).toMatchObject({ ...intent, public_key: real.publicKey });
      expect(
        await verifyNep413Signature(
          {
            accountId: "rita.near",
            publicKey: String(signed.public_key),
            signature: String(signed.signature),
          },
          { message: "update the rules", recipient: "intents.near", nonce },
        ),
      ).toBe(true);
      await expect(real.sign("rita.near", "ed25519:other", intent)).rejects.toThrow(
        "not the server's key",
      );
    });

    test("an unusable key turns server signing off instead of failing startup", () => {
      expect(ownerSignerFrom(undefined)).toBeNull();
      expect(ownerSignerFrom("not-a-key")).toBeNull();
    });
  });
});
