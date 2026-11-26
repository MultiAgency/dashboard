import { ASSETS, appClient } from "@multiagency/sdk";
import { type PayoutDouble, payoutDouble } from "@multiagency/sdk/testing";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  agentPayouts,
  platformAgents,
  platformConsents,
  platformPayouts,
} from "../../src/db/schema";
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
    payouts.send(ORG, { requestId, recipient: CAROL, amount });

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
    expect(await payouts.readiness(ORG, CAROL)).toMatchObject({ code: "owner_approval" });
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

  test("the switch to the platform waits for the old path, and the way back waits for the platform", async () => {
    await database.db.update(platformAgents).set({ payoutRoute: "legacy" });
    await database.db.insert(agentPayouts).values({
      id: "legacy-1",
      organizationId: ORG,
      requestId: "req-old",
      attempt: 1,
      status: "processing",
      idempotencyKey: "k",
      requestBody: "{}",
      recipient: CAROL,
      amount: "1",
      assetId: ASSETS.wNEAR,
    } as typeof agentPayouts.$inferInsert);
    await expect(payouts.setRoute(ORG, "platform")).rejects.toThrow(/aren't settled yet/);
    await database.db.update(agentPayouts).set({ status: "paid" });
    expect(await payouts.setRoute(ORG, "platform")).toEqual({
      organizationId: ORG,
      route: "platform",
    });

    holdEach();
    await pay();
    await expect(payouts.setRoute(ORG, "legacy")).rejects.toThrow(/platform payout/);
    double.vote("req-1-1", "approve");
    double.settle("req-1-1");
    await payouts.refresh((await payouts.latest("req-1"))!);
    expect(await payouts.setRoute(ORG, "legacy")).toMatchObject({ route: "legacy" });
  });

  test("the switch needs a consent that includes payouts", async () => {
    await database.db.update(platformConsents).set({ scopes: "owner,read" });
    await expect(payouts.setRoute(ORG, "platform")).rejects.toThrow(/includes payouts/);
  });

  test("the router sends each Organization's payouts its own way and finds each record where it is", async () => {
    const legacy = {
      readiness: vi.fn(async () => ({ ready: true, code: null, reason: null })),
      send: vi.fn(),
      refresh: vi.fn(),
      latest: vi.fn(async () => null),
    };
    const routed = routePayouts(legacy, payouts);
    await database.db.update(platformAgents).set({ payoutRoute: "legacy" });
    await routed.readiness(ORG, CAROL);
    expect(legacy.readiness).toHaveBeenCalledTimes(1);

    await database.db.update(platformAgents).set({ payoutRoute: "platform" });
    const sent = await routed.send(ORG, {
      requestId: "req-1",
      recipient: CAROL,
      amount: NEAR.toString(),
    });
    expect(legacy.send).not.toHaveBeenCalled();
    expect(await routed.latest("req-1")).toMatchObject({ id: sent.id });
    await routed.refresh(sent);
    expect(legacy.refresh).not.toHaveBeenCalled();
    await routed.latest("req-other");
    expect(legacy.latest).toHaveBeenCalledWith("req-other");

    expect(await routePayouts(null, payouts).readiness("orgElsewhere", CAROL)).toMatchObject({
      code: "no_agent",
    });
  });
});
