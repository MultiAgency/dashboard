import { ASSETS, appClient } from "@multiagency/sdk";
import { type PayoutDouble, payoutDouble } from "@multiagency/sdk/testing";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  agentPayouts,
  platformAgents,
  platformConsents,
  platformPayouts,
} from "../../src/db/schema";
import { oldPayoutLatest } from "../../src/services/payouts/history";
import { createPlatformAgents } from "../../src/services/platform/agents";
import { routePayouts } from "../../src/services/platform/payout-router";
import {
  createPlatformPayouts,
  noUnsettledPlatformPayout,
  type PlatformPayouts,
} from "../../src/services/platform/payouts";
import { migratedDatabase } from "./_pg";

const ORG = "orgStudio";
const AGENT = "own-studio";
const CAROL = "carol.near";
const NEAR = 10n ** 24n;
const SETTINGS = {
  base: "https://platform.test",
  host: "platform.test",
  deployment: "multiagency-dashboard",
  credential: "tap_x.y",
} as const;

const wnearPolicy = (overrides: Record<string, unknown> = {}) => ({
  frozen: false,
  actions: ["withdraw" as const],
  confidential: true,
  owner_approval: false,
  assets: [ASSETS.wNEAR],
  limits: { per_transaction: { [ASSETS.wNEAR]: (50n * NEAR).toString() } },
  max_actions_per_hour: 10,
  destinations: {
    mode: "only" as const,
    list: [{ action: "withdraw" as const, chain: "near", address: CAROL, memo: null }],
  },
  budget: { daily_usd: null, weekly_usd: null, monthly_usd: "100000" },
  timelock_ms: 0,
  ...overrides,
});

describe("work-order payouts through the platform", () => {
  const database = migratedDatabase({ perTest: true });
  let double: PayoutDouble;
  let payouts: PlatformPayouts;
  let clock: Date;

  async function connect(scopes = "owner,payout,read") {
    await database.db.insert(platformAgents).values({
      organizationId: ORG,
      ownerAccountId: "rita.near",
      area: "payables",
      host: SETTINGS.host,
      deployment: SETTINGS.deployment,
      agent: AGENT,
      agentId: "agent-id",
      updatedBy: "admin",
    });
    await database.db.insert(platformConsents).values({
      id: "consent-1",
      organizationId: ORG,
      agent: AGENT,
      agentId: "agent-id",
      kind: "consent",
      scopes,
      expiresAt: new Date("2027-06-01T00:00:00Z"),
      publicKey: "ed25519:x",
      message: "{}",
      createdBy: "admin",
    });
  }

  beforeEach(async () => {
    clock = new Date("2026-11-25T12:00:00.000Z");
    double = payoutDouble({
      organization: ORG,
      agent: AGENT,
      policy: wnearPolicy(),
      grant: { label: "payout", expiresAt: "2027-02-01T00:00:00Z" },
      balances: { [ASSETS.wNEAR]: (100n * NEAR).toString() },
      scopes: ["owner", "payout", "read"],
    });
    const app = appClient({
      base: double.base,
      credential: double.credential,
      fetch: double.fetch,
    });
    const agents = createPlatformAgents({
      db: database.db,
      app,
      settings: SETTINGS,
      now: () => clock,
    });
    payouts = createPlatformPayouts({
      db: database.db,
      app,
      agents,
      pendingPayees: async () => [],
      now: () => clock,
    });
    await connect();
  });

  const pay = (requestId = "req-1", amount = (2n * NEAR).toString()) =>
    payouts.send(ORG, { requestId, recipient: CAROL, amount, tokenId: "near" });

  const holdEach = () => double.setPolicy(wnearPolicy({ owner_approval: true }));

  test("a ready agent pays an agreed builder once, under an ID derived from the request", async () => {
    expect(await payouts.readiness(ORG, CAROL, (2n * NEAR).toString())).toEqual({
      ready: true,
      code: null,
      reason: null,
    });
    const sent = await pay();
    expect(sent).toMatchObject({ id: "req-1-1", requestId: "req-1", status: "paid" });
    expect(double.requests().map((r) => [r.requestId, r.method])).toEqual([
      ["req-1-1", "withdraw"],
    ]);
    expect(await payouts.latest("req-1")).toMatchObject({ status: "paid" });

    expect(await pay()).toMatchObject({ id: "req-1-1", status: "paid" });
    expect(double.requests()).toHaveLength(1);
  });

  test("an outcome the platform can't prove blocks the request; nothing is asked for under another ID", async () => {
    double.loseNextAnswer();
    const sent = await pay();
    expect(sent).toMatchObject({ status: "uncertain", provenUnsent: false });
    const [row] = await database.db.select().from(platformPayouts);
    expect(row).toMatchObject({
      requestId: "req-1-1",
      recipient: CAROL,
      amount: (2n * NEAR).toString(),
    });
    expect((await payouts.refresh(sent)).status).toBe("uncertain");
    expect((await pay()).id).toBe("req-1-1");
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1"]);
  });

  test("a reply lost on the way back is read by the same ID, not asked for again", async () => {
    let dropped = false;
    const lossy = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await double.fetch(input, init);
      if (!dropped && /payouts(%2F|\/)request/.test(String(input))) {
        dropped = true;
        throw new TypeError("connection reset");
      }
      return response;
    };
    const app = appClient({ base: double.base, credential: double.credential, fetch: lossy });
    const agents = createPlatformAgents({
      db: database.db,
      app,
      settings: SETTINGS,
      now: () => clock,
    });
    const lossyPayouts = createPlatformPayouts({
      db: database.db,
      app,
      agents,
      pendingPayees: async () => [],
      now: () => clock,
    });
    const sent = await lossyPayouts.send(ORG, {
      requestId: "req-1",
      recipient: CAROL,
      amount: NEAR.toString(),
      tokenId: "near",
    });
    expect(dropped).toBe(true);
    expect(sent).toMatchObject({ id: "req-1-1", status: "paid" });
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1"]);
  });

  test("a held payout waits, and a failure a person must check is never retried", async () => {
    holdEach();
    const held = await pay();
    expect(held).toMatchObject({ status: "processing", provenUnsent: false });
    expect(held.reason).toMatch(/owner's vote/);
    expect((await pay()).id).toBe("req-1-1");

    double.vote("req-1-1", "approve");
    double.settle("req-1-1", "FAILED");
    expect(await payouts.refresh(held)).toMatchObject({
      status: "needs_review",
      provenUnsent: false,
    });
    expect((await pay()).id).toBe("req-1-1");
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1"]);
  });

  test("a proven refusal is retried under the next attempt", async () => {
    double.setBalance(ASSETS.wNEAR, "0");
    expect(await pay()).toMatchObject({
      status: "refused",
      provenUnsent: true,
      reason: "insufficient_balance",
    });
    double.setBalance(ASSETS.wNEAR, (100n * NEAR).toString());
    expect(await pay()).toMatchObject({ id: "req-1-2", status: "paid" });
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1", "req-1-2"]);
  });

  test("a builder who doesn't exist on NEAR is refused before anything is recorded", async () => {
    double.recipients.absent(CAROL);
    expect(await pay()).toMatchObject({
      status: "refused",
      provenUnsent: true,
      reason: "recipient_not_found",
    });
  });

  describe("an Organization whose rules pay in USDC", () => {
    const USDC_TOKEN = ASSETS.USDC.replace(/^nep141:/, "");
    const USDC = 1_000_000n;
    const usdcPolicy = () =>
      wnearPolicy({
        actions: ["transfer" as const],
        assets: [ASSETS.USDC],
        limits: { per_transaction: { [ASSETS.USDC]: (5n * USDC).toString() } },
        destinations: {
          mode: "only" as const,
          list: [{ action: "transfer" as const, address: CAROL, confidential: true }],
        },
      });

    beforeEach(async () => {
      await database.db.update(platformAgents).set({ payoutAsset: "usdc" });
      double.setPolicy(usdcPolicy());
      double.setBalance(ASSETS.USDC, (20n * USDC).toString());
    });

    test("builders are paid in USDC by confidential transfer", async () => {
      expect(await payouts.payoutToken(ORG)).toBe(USDC_TOKEN);
      expect(await payouts.readiness(ORG, CAROL, 2n * USDC)).toEqual({
        ready: true,
        code: null,
        reason: null,
      });
      const sent = await payouts.send(ORG, {
        requestId: "req-1",
        recipient: CAROL,
        amount: (2n * USDC).toString(),
        tokenId: USDC_TOKEN,
      });
      expect(sent).toMatchObject({ status: "paid", assetId: ASSETS.USDC });
      expect(double.requests()).toMatchObject([
        { requestId: "req-1-1", method: "transfer", request: { asset: ASSETS.USDC } },
      ]);
      expect(await payouts.fundingCheck(ORG, { near: 1n, priceUsd: null })).toBeNull();
    });

    test("readiness speaks in USDC, and a withdrawal payee isn't one for transfers", async () => {
      expect(await payouts.readiness(ORG, CAROL, 6n * USDC)).toMatchObject({
        code: "over_cap",
        reason: "6 USDC is over the 5 USDC cap per payout",
      });
      double.setPolicy(wnearPolicy({ assets: [ASSETS.USDC] }));
      expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "payee_not_allowed" });
    });

    test("a payout priced in another token is refused before anything is recorded", async () => {
      await expect(pay()).rejects.toThrow(/now pays in USDC/);
      expect(await payouts.latest("req-1")).toBeNull();
      expect(double.requests()).toEqual([]);
    });
  });

  test("readiness says why the agent can't pay, in the codes work orders already use", async () => {
    expect(await payouts.readiness(ORG, "dave.near")).toMatchObject({ code: "payee_not_allowed" });
    expect(await payouts.readiness(ORG, CAROL, (60n * NEAR).toString())).toMatchObject({
      code: "over_cap",
    });
    expect(await payouts.readiness(ORG, CAROL, (200n * NEAR).toString())).toMatchObject({
      code: "over_cap",
    });
    double.setGrant(null);
    expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "no_grant" });
    double.setPolicy(wnearPolicy({ frozen: true }));
    expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "frozen" });
    double.setPolicy(wnearPolicy({ owner_approval: true }));
    expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "no_grant" });
    double.setGrant({ label: "payout", expiresAt: "2027-02-01T00:00:00Z" });
    expect(await payouts.readiness(ORG, CAROL)).toEqual({ ready: true, code: null, reason: null });
  });

  test("a payout the owner rejected stays unsent: no new attempt, and a DAO proposal may pay it", async () => {
    holdEach();
    const held = await pay();
    double.vote("req-1-1", "reject");
    expect(await payouts.refresh(held)).toMatchObject({
      status: "rejected",
      provenUnsent: true,
      reason: "The agent's owner rejected this payout",
    });
    expect((await pay()).id).toBe("req-1-1");
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1"]);
    const free = await database.db
      .select({ id: platformPayouts.requestId })
      .from(platformPayouts)
      .where(sql`${noUnsettledPlatformPayout(platformPayouts.compensationRequestId)}`);
    expect(free).toEqual([{ id: "req-1-1" }]);
  });

  test("payouts of the same terms are each held for a vote, since their IDs already tell them apart", async () => {
    holdEach();
    expect(await pay("req-1")).toMatchObject({ status: "processing" });
    expect(await pay("req-2")).toMatchObject({ status: "processing" });
    expect(double.requests().map((r) => [r.requestId, r.refused])).toEqual([
      ["req-1-1", null],
      ["req-2-1", null],
    ]);
  });

  test("without payout in the consent nothing is asked for", async () => {
    await database.db.update(platformConsents).set({ scopes: "owner,read" });
    expect(await payouts.readiness(ORG, CAROL)).toMatchObject({
      ready: false,
      code: "unreachable",
    });
    await expect(pay()).rejects.toThrow(/can't be asked to pay/);
    expect(double.requests()).toHaveLength(0);
  });

  test("a DAO proposal can't pay a request while its platform payout is unsettled", async () => {
    const settledFor = async () =>
      (
        await database.db
          .select({ id: platformPayouts.requestId })
          .from(platformPayouts)
          .where(sql`${noUnsettledPlatformPayout(platformPayouts.compensationRequestId)}`)
      ).length;
    holdEach();
    await pay();
    expect(await settledFor()).toBe(0);
    double.vote("req-1-1", "approve");
    double.settle("req-1-1", "FAILED");
    await payouts.refresh((await payouts.latest("req-1"))!);
    expect(await settledFor()).toBe(0);
    await database.db
      .update(platformPayouts)
      .set({ neverExecuted: true })
      .where(eq(platformPayouts.requestId, "req-1-1"));
    expect(await settledFor()).toBe(1);
  });

  test("an old-path payout still on record counts when it's the newer one, and blocks a platform send", async () => {
    double.setBalance(ASSETS.wNEAR, "0");
    expect(await pay()).toMatchObject({ id: "req-1-1", status: "refused" });
    double.setBalance(ASSETS.wNEAR, (100n * NEAR).toString());
    await database.db.insert(agentPayouts).values({
      id: "legacy-1",
      organizationId: ORG,
      requestId: "req-1",
      attempt: 1,
      status: "processing",
      idempotencyKey: "k",
      requestBody: "{}",
      recipient: CAROL,
      amount: "1",
      assetId: ASSETS.wNEAR,
      createdAt: new Date(clock.getTime() + 60_000),
    } as typeof agentPayouts.$inferInsert);
    const routed = routePayouts(oldPayoutLatest(database.db), payouts);
    expect(await routed.latest("req-1")).toMatchObject({ id: "legacy-1", status: "processing" });
    expect(
      await routed.send(ORG, {
        requestId: "req-1",
        recipient: CAROL,
        amount: NEAR.toString(),
        tokenId: "near",
      }),
    ).toMatchObject({ id: "legacy-1" });
    expect(await routed.refresh((await routed.latest("req-1"))!)).toMatchObject({ id: "legacy-1" });
    expect(double.requests().map((r) => r.requestId)).toEqual(["req-1-1"]);
  });
  test("a gateway refusal while asking again leaves the payout in flight, never a new ID", async () => {
    await database.db.insert(platformPayouts).values({
      requestId: "req-1-1",
      compensationRequestId: "req-1",
      attempt: 1,
      organizationId: ORG,
      agent: AGENT,
      asset: ASSETS.wNEAR,
      chain: "near",
      recipient: CAROL,
      amount: NEAR.toString(),
      expectedRevision: 1,
      expectedDigest: "d",
      state: "sending",
      createdAt: clock,
    });
    double.revokeConsent();
    const view = await payouts.refresh((await payouts.latest("req-1"))!);
    expect(view).toMatchObject({ status: "sending", provenUnsent: false });
    await expect(pay()).rejects.toThrow(/can't be asked to pay/);
    expect(await payouts.latest("req-1")).toMatchObject({ id: "req-1-1", status: "sending" });
    expect(double.requests()).toHaveLength(0);
  });

  test("the router asks the platform only for an Organization that pays through it", async () => {
    const routed = routePayouts(oldPayoutLatest(database.db), payouts);
    expect(await routed.readiness(ORG, CAROL)).toMatchObject({ ready: true });
    const sent = await routed.send(ORG, {
      requestId: "req-1",
      recipient: CAROL,
      amount: NEAR.toString(),
      tokenId: "near",
    });
    expect(await routed.latest("req-1")).toMatchObject({ id: sent.id });

    expect(await routed.readiness("orgElsewhere", CAROL)).toEqual({
      ready: false,
      code: "no_agent",
      reason: "No payout agent",
    });
    const strict = createPlatformPayouts({
      db: database.db,
      app: appClient({ base: double.base, credential: double.credential, fetch: double.fetch }),
      agents: createPlatformAgents({ db: database.db, app: null, settings: SETTINGS }),
      pendingPayees: async () => {
        throw new Error("This Organization has no connected platform agent");
      },
    });
    expect(
      await routePayouts(oldPayoutLatest(database.db), strict).ensurePayees?.("orgElsewhere"),
    ).toEqual({ ok: true, reason: null });
    await database.db.update(platformConsents).set({ scopes: "owner,read" });
    expect(await routed.readiness(ORG, CAROL)).toMatchObject({ code: "no_agent" });
  });
});
