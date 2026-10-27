import { generateKey } from "near-kit";
import { beforeEach, describe, expect, test } from "vitest";
import { nearToAtomic } from "../../src/services/payouts/policy";
import { createPayoutAgents, type PayoutAgents } from "../../src/services/payouts/service";
import { FakeAgentApi } from "../fakes/agent-api";
import { migratedDatabase } from "./_pg";

const ORG = "studio";
const CAROL = "carol.near";
const DAVE = "dave.near";
const NEAR = 10n ** 24n;

describe("payout funding and automatic payee rules", () => {
  const database = migratedDatabase({ perTest: true });
  let agent: FakeAgentApi;
  let clock: Date;
  let payees: string[];
  let ownerKeys: string[];

  beforeEach(() => {
    agent = new FakeAgentApi();
    clock = new Date("2026-09-20T12:00:00.000Z");
    payees = [CAROL];
    ownerKeys = ["ed25519:owner"];
  });

  function payoutsWith(): PayoutAgents {
    return createPayoutAgents({
      db: database.db,
      api: agent,
      secretKey: "test-secret",
      payees: async () => payees,
      fullAccessKeys: async () => ownerKeys,
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
      signedData: await agent.sign(create.intent),
    });
    if (options.grant === false) return;
    const grant = await payouts.prepare(ORG, { action: "issue_grant" });
    await payouts.submit(ORG, {
      correlationId: grant.correlationId,
      signedData: await agent.sign(grant.intent),
    });
  }

  async function walletFreeze(payouts: PayoutAgents) {
    const freeze = await payouts.prepare(ORG, { action: "freeze" });
    await payouts.submit(ORG, {
      correlationId: freeze.correlationId,
      signedData: await agent.sign(freeze.intent),
    });
  }

  async function signRules(payouts: PayoutAgents) {
    const sync = await payouts.prepare(ORG, { action: "sync_policy" });
    return payouts.submit(ORG, {
      correlationId: sync.correlationId,
      signedData: await agent.sign(sync.intent),
    });
  }

  describe("ensurePayees", () => {
    test("a new builder waits for the owner to sign the updated rules", async () => {
      const payouts = payoutsWith();
      await setUp(payouts);
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: true,
        reason: null,
        needsSignature: false,
      });
      payees = [CAROL, DAVE];
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: false,
        reason: `Sign the updated rules to allow paying ${DAVE}`,
        needsSignature: true,
      });
      expect(agent.generated.some((g) => g.type === "policy_update")).toBe(false);

      await signRules(payouts);
      expect(agent.policy?.destinations.list.map((d) => d.address)).toEqual([CAROL, DAVE]);
      expect((await payouts.view(ORG)).changes).toEqual([]);
      expect(await payouts.ensurePayees(ORG)).toMatchObject({ ok: true });
      expect(await payouts.readiness(ORG, DAVE)).toEqual({ ready: true, code: null, reason: null });
    });

    test("during the rules cooldown it says when the rules can change", async () => {
      const payouts = payoutsWith();
      await setUp(payouts);
      payees = [CAROL, DAVE];
      agent.policyChangeAvailableAt = "2026-09-20T14:30:00.000Z";
      expect(await payouts.ensurePayees(ORG)).toEqual({
        ok: false,
        reason: "Rules can change again at 2026-09-20 14:30 UTC",
        needsSignature: false,
      });
      clock = new Date("2026-09-20T14:31:00.000Z");
      expect(await payouts.ensurePayees(ORG)).toMatchObject({ ok: false, needsSignature: true });
    });
  });

  describe("upkeep", () => {
    test("an agent still being created is picked up later and can't be created twice", async () => {
      const payouts = payoutsWith();
      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "5000",
        maxPayoutNear: "500",
      });
      const create = await payouts.prepare(ORG, {
        action: "create_agent",
        publicKey: `ed25519:${"1".repeat(44)}`,
      });
      agent.nextSubmit = "PROCESSING";
      const submitted = await payouts.submit(ORG, {
        correlationId: create.correlationId,
        signedData: await agent.sign(create.intent),
      });
      expect(submitted.status).toBe("PROCESSING");
      expect((await payouts.view(ORG)).agentId).toBeNull();
      await expect(
        payouts.prepare(ORG, { action: "create_agent", publicKey: `ed25519:${"1".repeat(44)}` }),
      ).rejects.toThrow("still being created");

      agent.statuses.set(create.correlationId, {
        status: "SUCCESS",
        details: { agent_id: "agent-1" },
      });
      expect(await payouts.maintain()).toMatchObject({ intentsSettled: 1 });
      expect((await payouts.view(ORG)).agentId).toBe("agent-1");
    });
  });

  describe("grant follow-up", () => {
    test("a grant that settles late never replaces a newer one", async () => {
      const payouts = payoutsWith();
      await setUp(payouts, { grant: false });
      const first = await payouts.prepare(ORG, { action: "issue_grant" });
      agent.nextSubmit = "PROCESSING";
      await payouts.submit(ORG, {
        correlationId: first.correlationId,
        signedData: await agent.sign(first.intent),
      });
      clock = new Date("2026-09-20T13:00:00.000Z");
      const second = await payouts.prepare(ORG, { action: "issue_grant" });
      await payouts.submit(ORG, {
        correlationId: second.correlationId,
        signedData: await agent.sign(second.intent),
      });
      expect((await payouts.view(ORG)).grantExpiresAt).toBe("2026-12-19T13:00:00.000Z");
      agent.statuses.set(first.correlationId, { status: "SUCCESS", details: {} });
      expect(await payouts.maintain()).toMatchObject({ intentsSettled: 1 });
      expect((await payouts.view(ORG)).grantExpiresAt).toBe("2026-12-19T13:00:00.000Z");
    });
  });

  describe("creating the agent", () => {
    const signedIn = `ed25519:${"2".repeat(44)}`;
    const other = `ed25519:${"3".repeat(44)}`;

    async function saveSettings(payouts: PayoutAgents) {
      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "5000",
        maxPayoutNear: "500",
      });
    }

    test("an owner with several full-access keys uses the key they signed in with", async () => {
      ownerKeys = [other, signedIn];
      const payouts = payoutsWith();
      await saveSettings(payouts);
      await expect(payouts.prepare(ORG, { action: "create_agent" })).rejects.toThrow(
        "has 2 full-access keys",
      );
      await payouts.prepare(ORG, {
        action: "create_agent",
        signedInKeys: { "rita.near": signedIn },
      });
      expect(agent.generated.at(-1)).toMatchObject({
        owner: { account_id: "rita.near", public_key: signedIn },
      });
    });

    test("a sign-in key that is no longer a full-access key of the owner isn't used", async () => {
      ownerKeys = [other, `ed25519:${"4".repeat(44)}`];
      const payouts = payoutsWith();
      await saveSettings(payouts);
      await expect(
        payouts.prepare(ORG, { action: "create_agent", signedInKeys: { "rita.near": signedIn } }),
      ).rejects.toThrow("has 2 full-access keys");
    });
  });

  describe("grant reminders", () => {
    test("managers are reminded once per grant when under 14 days remain", async () => {
      const payouts = payoutsWith();
      await setUp(payouts);
      expect((await payouts.maintain()).grantReminders).toEqual([]);
      clock = new Date("2026-12-10T12:00:00.000Z");
      expect((await payouts.view(ORG)).grantExpiringSoon).toBe(true);
      const { grantReminders } = await payouts.maintain();
      expect(grantReminders).toEqual([
        { organizationId: ORG, expiresAt: new Date("2026-12-19T12:00:00.000Z") },
      ]);
      expect((await payouts.maintain()).grantReminders).toEqual([]);

      const grant = await payouts.prepare(ORG, { action: "issue_grant" });
      await payouts.submit(ORG, {
        correlationId: grant.correlationId,
        signedData: await agent.sign(grant.intent),
      });
      expect((await payouts.view(ORG)).grantExpiresAt).toBe("2027-03-10T12:00:00.000Z");
      expect((await payouts.maintain()).grantReminders).toEqual([]);
    });
  });

  describe("readiness", () => {
    test("each blocker has its own code", async () => {
      const payouts = payoutsWith();
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ ready: false, code: "no_agent" });
      await setUp(payouts, { grant: false });
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ ready: false, code: "no_grant" });
      const grant = await payouts.prepare(ORG, { action: "issue_grant" });
      await payouts.submit(ORG, {
        correlationId: grant.correlationId,
        signedData: await agent.sign(grant.intent),
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
      const payouts = payoutsWith();
      await setUp(payouts);
      agent.policy = null;
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "not_applied" });
    });
  });

  describe("fundingCheck", () => {
    test("reports the shortfall rounded up and whether the monthly budget covers the need", async () => {
      const payouts = payoutsWith();
      expect(await payouts.fundingCheck(ORG, { near: NEAR, priceUsd: "4" })).toBeNull();
      await setUp(payouts);
      agent.balanceRaw = (10n * NEAR).toString();
      const needs = { near: 25n * NEAR + 5n * 10n ** 21n, priceUsd: "4" };
      expect(await payouts.fundingCheck(ORG, needs)).toEqual({
        balanceNear: "10",
        neededNear: "25.005",
        shortfallNear: "15.01",
        monthlyBudgetUsd: "5000",
        monthlyRemainingUsd: "5000.00",
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
        signedData: await agent.sign(sync.intent),
      });
      agent.balanceRaw = (30n * NEAR).toString();
      agent.monthlySpentUsd = "20";
      expect(await payouts.fundingCheck(ORG, needs)).toMatchObject({
        shortfallNear: "0",
        monthlyBudgetUsd: "50",
        monthlyRemainingUsd: "30.00",
        monthlyNeededUsd: "100.02",
        suggestedBudgetUsd: "101",
        budgetTooLow: true,
        lowBalance: false,
      });
    });

    test("falls back to the agent's NEAR price when no price is given", async () => {
      const payouts = payoutsWith();
      await setUp(payouts);
      expect(await payouts.fundingCheck(ORG, { near: 3n * NEAR, priceUsd: null })).toMatchObject({
        monthlyNeededUsd: "6.00",
        shortfallNear: "3",
      });
    });

    test("a raised budget applies once the owner signs the rules", async () => {
      const payouts = payoutsWith();
      await setUp(payouts);
      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "9000",
        maxPayoutNear: "500",
      });
      expect(await payouts.ensurePayees(ORG)).toMatchObject({ ok: false, needsSignature: true });
      await signRules(payouts);
      expect(agent.policy?.budget.monthly_usd).toBe("9000");
      const view = await payouts.view(ORG);
      expect(view.policy).toMatchObject({ monthlyLimitUsd: "9000", monthlyResetsAt: null });
    });
  });

  describe("owner signatures", () => {
    test("only the owner's signature over exactly the prepared intent is relayed", async () => {
      const payouts = payoutsWith();
      await payouts.saveSettings(ORG, "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "5000",
        maxPayoutNear: "500",
      });
      const create = await payouts.prepare(ORG, {
        action: "create_agent",
        publicKey: `ed25519:${"1".repeat(44)}`,
      });
      const intent = create.intent as { standard: string; payload: Record<string, unknown> };
      const tampered = await agent.sign({
        ...intent,
        payload: { ...intent.payload, receiverId: "evil.near" },
      });
      await expect(
        payouts.submit(ORG, {
          correlationId: create.correlationId,
          signedData: { ...tampered, payload: intent.payload },
        }),
      ).rejects.toThrow("calls another contract");
      await expect(
        payouts.submit(ORG, {
          correlationId: create.correlationId,
          signedData: await agent.sign(intent, generateKey()),
        }),
      ).rejects.toThrow("isn't the owner's");
      expect(agent.submitted).toEqual([]);
      await payouts.submit(ORG, {
        correlationId: create.correlationId,
        signedData: await agent.sign(intent),
      });
      expect(agent.submitted).toHaveLength(1);

      const grant = await payouts.prepare(ORG, { action: "issue_grant" });
      const signed = await agent.sign(grant.intent);
      const forged = (await agent.sign(grant.intent, generateKey())) as { signature?: string };
      await expect(
        payouts.submit(ORG, {
          correlationId: grant.correlationId,
          signedData: { ...signed, signature: forged.signature },
        }),
      ).rejects.toThrow("doesn't verify");
      await payouts.submit(ORG, { correlationId: grant.correlationId, signedData: signed });
      expect(agent.submitted).toHaveLength(2);
    });
  });
});
