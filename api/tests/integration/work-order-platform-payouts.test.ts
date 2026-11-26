import { ASSETS, appClient } from "@multiagency/sdk";
import { type PayoutDouble, payoutDouble } from "@multiagency/sdk/testing";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Database } from "../../src/db";
import {
  billings,
  compensationRequests,
  notifications,
  platformAgents,
  platformConsents,
  platformPayouts,
  workOrders,
} from "../../src/db/schema";
import { requireTreasury } from "../../src/services/organization-access";
import { oldPayoutLatest } from "../../src/services/payouts/history";
import { createPlatformAgents } from "../../src/services/platform/agents";
import { routePayouts } from "../../src/services/platform/payout-router";
import { createPlatformPayouts } from "../../src/services/platform/payouts";
import type { ConsistencyResult } from "../../src/services/work-orders/consistency";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import {
  type BuilderProfile,
  createWorkOrdersService,
} from "../../src/services/work-orders/service";
import { DEFAULT_RENEWAL } from "../../src/services/work-orders/types";
import { type EngagementWorld, engagementWorld } from "../fakes/engagements";
import { FakeGitHub } from "../fakes/github";
import { signedIn } from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

const DAO = "studio.sputnik-dao.testnet";
const REPO = "studio/app";
const EMPTY_REPO = "studio/empty";
const CAROL = "carol.near";
const AGENT = "own-studio";
const NEAR = 10n ** 24n;
const CONSISTENT: ConsistencyResult = { verdict: "consistent", concerns: [], confidence: 0.9 };
const POLICY = {
  frozen: false,
  actions: ["withdraw" as const],
  confidential: true,
  owner_approval: false,
  assets: [ASSETS.wNEAR],
  limits: { per_transaction: { [ASSETS.wNEAR]: (500n * NEAR).toString() } },
  max_actions_per_hour: 10,
  destinations: {
    mode: "only" as const,
    list: [{ action: "withdraw" as const, chain: "near", address: CAROL, memo: null }],
  },
  budget: { daily_usd: null, weekly_usd: null, monthly_usd: "100000" },
  timelock_ms: 0,
};
const SETTINGS = {
  base: "https://platform.test",
  host: "platform.test",
  deployment: "multiagency-dashboard",
  credential: "tap_x.y",
} as const;

describe("work-order payouts through the platform agent", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let world: EngagementWorld;
  let github: FakeGitHub;
  let clock: Date;
  let double: PayoutDouble;
  let verdict: ConsistencyResult | null | Error;
  let service: ReturnType<typeof createWorkOrdersService>;
  let deps: Parameters<typeof createWorkOrdersService>[0];

  beforeEach(async () => {
    db = database.db;
    world = await engagementWorld(db);
    github = new FakeGitHub()
      .addRepo(REPO, { admins: ["maint-gh", "admin-gh"] })
      .addRepo(EMPTY_REPO, { admins: ["maint-gh", "admin-gh"] });
    clock = new Date("2026-09-20T12:00:00.000Z");
    verdict = CONSISTENT;
    double = payoutDouble({
      organization: "studio",
      agent: AGENT,
      policy: POLICY,
      grant: { label: "payout", expiresAt: "2027-06-01T00:00:00Z" },
      balances: { [ASSETS.wNEAR]: (1000n * NEAR).toString() },
      scopes: ["owner", "payout", "read"],
    });
    const app = appClient({
      base: double.base,
      credential: double.credential,
      fetch: double.fetch,
    });
    const agents = createPlatformAgents({ db, app, settings: SETTINGS, now: () => clock });
    const platform = createPlatformPayouts({
      db,
      app,
      agents,
      pendingPayees: async () => [],
      now: () => clock,
    });
    await db.insert(platformAgents).values({
      organizationId: "studio",
      ownerAccountId: "rita.near",
      area: "payables",
      host: SETTINGS.host,
      deployment: SETTINGS.deployment,
      agent: AGENT,
      agentId: "agent-id",
      updatedBy: "studio-admin",
    });
    await db.insert(platformConsents).values({
      id: "consent-1",
      organizationId: "studio",
      agent: AGENT,
      agentId: "agent-id",
      kind: "consent",
      scopes: "owner,payout,read",
      expiresAt: new Date("2027-06-01T00:00:00Z"),
      publicKey: "ed25519:x",
      message: "{}",
      createdBy: "studio-admin",
    });
    const builders = new Map<string, BuilderProfile>([
      [CAROL, { nearAccount: CAROL, name: "Carol", githubLogin: "carol-gh", userId: "carol" }],
    ]);
    deps = {
      db,
      directory: world.directory,
      scopeOfOrganization: (organizationId) => world.access.readScopeOfAgency({}, organizationId),
      agencyDaoOf: async (organizationId) => (organizationId === "studio" ? DAO : null),
      organizationName: async (organizationId) =>
        organizationId === "studio" ? "Studio" : organizationId,
      builders: { get: async (nearAccount) => builders.get(nearAccount) ?? null },
      github,
      ownership: (repo) => github.getRepoOwnership(repo),
      orgRepos: (org) => github.listOrgRepos(org),
      proposal: async () => null,
      proposalsSince: async () => [],
      proposalBond: async () => "100000000000000000000000",
      prices: { price: async () => ({ priceUsd: "4.99", at: "2026-09-20T12:00:00.000Z" }) },
      summarizer: { draftReport: async () => null },
      notifications: world.notifications,
      thresholds: DEFAULT_RENEWAL,
      payouts: routePayouts(oldPayoutLatest(db), platform),
      consistency: {
        check: async () => {
          if (verdict instanceof Error) throw verdict;
          return verdict;
        },
      },
      now: () => clock,
    };
    service = createWorkOrdersService(deps);
  });

  const studio = () => world.manager("studio-admin", "studio");
  const carol = () => signedIn("carol", null, CAROL);
  const integrations = () => createWorkOrderIntegrations({ db, now: () => clock });

  const fields = (over: Record<string, unknown> = {}) => ({
    projectId: "p1",
    builderNearAccount: CAROL,
    title: "Contributor role",
    repos: [REPO],
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    tokenId: "usd",
    budgetAmount: "1000000000",
    ...over,
  });

  async function active(over: Record<string, unknown> = {}) {
    const created = await service.create(await studio(), fields(over));
    await service.offer(await studio(), { id: created.id });
    const doc = await service.myDocument(carol(), { id: created.id });
    await service.sign(carol(), { id: created.id, documentSha256: doc.sha256, name: "Carol" });
    const prior = clock;
    clock = new Date("2026-08-31T12:00:00.000Z");
    const activated = await service.countersign(await studio(), {
      id: created.id,
      name: "Rita Rep",
    });
    clock = prior;
    expect(activated.status).toBe("active");
    await db
      .update(workOrders)
      .set({ payeeConfirmedAt: clock })
      .where(eq(workOrders.id, activated.id));
    return activated;
  }

  function strongEvidence() {
    for (let w = 0; w < 4; w++) {
      const d = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;
      github
        .issue(REPO, 100 + w)
        .assign("carol-gh", `${d(1 + w * 7)}T10:00:00Z`, "maint-gh")
        .close(`${d(3 + w * 7)}T13:00:00Z`);
      github.pull(REPO, 200 + w, {
        author: "carol-gh",
        createdAt: `${d(1 + w * 7)}T12:00:00Z`,
        mergedAt: `${d(3 + w * 7)}T12:00:00Z`,
        closes: [100 + w],
      });
    }
  }

  const WEEKS: [string, string][] = [
    ["2026-09-01", "2026-09-07"],
    ["2026-09-08", "2026-09-14"],
    ["2026-09-15", "2026-09-21"],
    ["2026-09-22", "2026-09-28"],
  ];

  async function paidHistory(periods: number) {
    strongEvidence();
    const wo = await active();
    await service.collect(await studio(), { id: wo.id });
    for (const [coversFrom, coversTo] of WEEKS.slice(0, periods)) {
      const draft = await service.mineDraftRequest(carol(), { id: wo.id, coversFrom, coversTo });
      await service.editRequest(carol(), { requestId: draft.id, requestedAmount: "100000000" });
      await service.submitRequest(carol(), { requestId: draft.id });
      await db
        .update(compensationRequests)
        .set({
          status: "paid",
          approvedAmount: "100000000",
          approvedBy: "studio-admin",
          decidedAt: clock,
          paidAt: clock,
        })
        .where(eq(compensationRequests.id, draft.id));
    }
    return wo;
  }

  async function automatic(vetoHours = 24) {
    await integrations().saveTrust("studio", "studio-admin", { mode: "auto", vetoHours });
  }

  async function submit(
    workOrderId: string,
    input: { coversFrom?: string; coversTo?: string; amount?: string } = {},
  ) {
    await service.collect(await studio(), { id: workOrderId });
    const draft = await service.mineDraftRequest(carol(), {
      id: workOrderId,
      coversFrom: input.coversFrom,
      coversTo: input.coversTo,
    });
    await service.editRequest(carol(), {
      requestId: draft.id,
      requestedAmount: input.amount ?? "600000000",
    });
    const submitted = await service.submitRequest(carol(), { requestId: draft.id });
    return { submitted, admin: () => adminRequest(workOrderId, draft.id) };
  }

  async function adminRequest(workOrderId: string, requestId: string) {
    const detail = await service.get(await studio(), { id: workOrderId });
    const request = detail.requests.find((r) => r.id === requestId);
    if (!request) throw new Error("request missing");
    return request;
  }

  async function kindsOf(userId: string) {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId));
    return rows.map((n) => n.kind);
  }

  test("a trusted builder's compensation is approved and paid through the platform agent, once", async () => {
    await paidHistory(4);
    clock = new Date("2026-11-05T12:00:00.000Z");
    await automatic();
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    expect(submitted.status).toBe("paid");
    expect((await admin()).agentPayout).toMatchObject({
      status: "paid",
      tokenId: "near",
      accountUrl: `https://nearblocks.io/address/${CAROL}`,
    });
    const sent = double.requests();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ requestId: `${submitted.id}-1`, method: "withdraw" });
    expect(sent[0]?.request).toMatchObject({ recipient: CAROL, asset: ASSETS.wNEAR });
    expect(await kindsOf("studio-admin")).toContain("compensation_request_auto_approved");
    const { data } = await world.notifications.list("carol", { limit: 50 });
    const paid = data.find((n) => n.kind === "compensation_request_paid");
    expect(paid?.body).toMatch(
      /^[\d.,]+ NEAR for WO-\d+-R\d+ was paid through Studio's payout agent\.$/,
    );
  });

  test("a payout the platform refuses waits, and the scheduled run pays it under the next attempt", async () => {
    await paidHistory(4);
    clock = new Date("2026-11-05T12:00:00.000Z");
    await automatic();
    const wo = await active();
    double.setBalance(ASSETS.wNEAR, "0");
    const { submitted } = await submit(wo.id);
    expect(submitted.status).toBe("approved");
    const [blocked] = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.id, submitted.id));
    expect(blocked?.autoPayBlockedReason).toBe("insufficient_balance");

    double.setBalance(ASSETS.wNEAR, (1000n * NEAR).toString());
    clock = new Date(clock.getTime() + 6 * 60_000);
    await service.run();
    const [paid] = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.id, submitted.id));
    expect(paid?.status).toBe("paid");
    expect(double.requests().map((r) => r.requestId)).toEqual([
      `${submitted.id}-1`,
      `${submitted.id}-2`,
    ]);
  });

  test("a payout a person must check blocks paying the request through a DAO proposal", async () => {
    await paidHistory(4);
    clock = new Date("2026-11-05T12:00:00.000Z");
    await automatic();
    const wo = await active();
    double.loseNextAnswer();
    const next = await submit(wo.id);
    const requestId = next.submitted.id;
    expect(next.submitted.status).toBe("paying");
    await expect(
      service.startDaoPayment(requireTreasury(await studio()), { requestId }),
    ).rejects.toThrow();

    await db
      .update(platformPayouts)
      .set({ state: "failed", neverExecuted: false })
      .where(eq(platformPayouts.requestId, `${requestId}-1`));
    clock = new Date(clock.getTime() + 6 * 60_000);
    await service.run();
    const [review] = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.id, requestId));
    expect(review).toMatchObject({ status: "approved", autoPayBlockedCode: "needs_review" });
    await expect(
      service.startDaoPayment(requireTreasury(await studio()), { requestId }),
    ).rejects.toThrow();
    expect(double.requests().filter((r) => r.requestId.startsWith(requestId))).toHaveLength(1);
  });

  test("a payout the owner rejects is held, never sent again, and can be paid through a DAO proposal", async () => {
    await paidHistory(4);
    clock = new Date("2026-11-05T12:00:00.000Z");
    await automatic();
    double.setPolicy({ ...POLICY, owner_approval: true });
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    const requestId = submitted.id;
    expect(submitted.status).toBe("paying");
    expect((await admin()).agentPayout?.reason).toMatch(/owner's vote/);

    double.vote(`${requestId}-1`, "reject");
    for (const minutes of [6, 12, 18]) {
      clock = new Date(Date.parse("2026-11-05T12:00:00.000Z") + minutes * 60_000);
      await service.run();
    }
    const [settled] = await db
      .select()
      .from(compensationRequests)
      .where(eq(compensationRequests.id, requestId));
    expect(settled).toMatchObject({
      status: "approved",
      autoPayBlockedCode: "owner_rejected",
      autoPayBlockedAt: null,
    });
    expect(settled?.note).toMatch(/isn't sent again automatically/);
    expect(double.requests().filter((r) => r.requestId.startsWith(requestId))).toHaveLength(1);
    expect(
      (await kindsOf("studio-admin")).filter((k) => k === "compensation_request_payout_failed"),
    ).toHaveLength(1);
    const dao = await service
      .startDaoPayment(requireTreasury(await studio()), { requestId })
      .catch((error: Error) => error);
    expect(dao instanceof Error ? dao.message : "").not.toMatch(/automatic payout/);
  });

  test("a work order says whether approved requests pay automatically, and in which token", async () => {
    clock = new Date("2026-11-05T12:00:00.000Z");
    const wo = await active();
    expect((await service.get(await studio(), { id: wo.id })).autoPay).toEqual({
      tokenId: "near",
    });
    await db.update(platformConsents).set({ scopes: "owner,read" });
    expect((await service.get(await studio(), { id: wo.id })).autoPay).toBeNull();
  });

  test("a manual approval answers before a slow payout finishes, and the payout carries on", async () => {
    clock = new Date("2026-11-05T12:00:00.000Z");
    const wo = await active();
    const { submitted } = await submit(wo.id);
    expect(submitted.status).toBe("submitted");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payouts = deps.payouts;
    if (!payouts) throw new Error("payouts are wired in beforeEach");
    const slow = createWorkOrdersService({
      ...deps,
      approvalPayoutWaitMs: 20,
      payouts: {
        ...payouts,
        send: async (organizationId, input) => {
          await gate;
          return payouts.send(organizationId, input);
        },
      },
    });
    const approved = await slow.approveRequest(await studio(), {
      requestId: submitted.id,
      amount: "600000000",
      allowWithoutEvidence: true,
    });
    expect(approved.status).toBe("paying");
    expect(double.requests()).toEqual([]);

    release();
    await vi.waitFor(async () => {
      const [paid] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, submitted.id));
      expect(paid?.status).toBe("paid");
    });
    expect(double.requests()).toHaveLength(1);
  });

  describe("an Organization whose agent pays in USDC", () => {
    const USDC_TOKEN = ASSETS.USDC.replace(/^nep141:/, "");

    beforeEach(async () => {
      await db.update(platformAgents).set({ payoutAsset: "usdc" });
      double.setPolicy({
        ...POLICY,
        actions: ["transfer" as const],
        assets: [ASSETS.USDC],
        limits: { per_transaction: { [ASSETS.USDC]: "1000000000" } },
        destinations: {
          mode: "only" as const,
          list: [{ action: "transfer" as const, address: CAROL, confidential: true }],
        },
      });
      double.setBalance(ASSETS.USDC, "5000000000");
    });

    test("a USD-priced request is paid its approved dollars in USDC, by confidential transfer", async () => {
      await paidHistory(4);
      clock = new Date("2026-11-05T12:00:00.000Z");
      await automatic();
      const wo = await active();
      const { submitted, admin } = await submit(wo.id);
      expect(submitted.status).toBe("paid");
      expect(double.requests()).toMatchObject([
        {
          requestId: `${submitted.id}-1`,
          method: "transfer",
          request: { asset: ASSETS.USDC, amount: "600000000", recipient: CAROL },
        },
      ]);
      expect((await admin()).agentPayout).toMatchObject({
        status: "paid",
        tokenId: USDC_TOKEN,
        accountUrl: null,
      });
      const [paid] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, submitted.id));
      expect(paid).toMatchObject({ payoutTokenId: USDC_TOKEN, payoutAmount: "600000000" });
      expect(
        await service.payoutReadiness(await studio(), {
          requestId: submitted.id,
          amount: "600000000",
        }),
      ).toEqual({
        ready: true,
        code: null,
        reason: null,
        near: null,
        balanceNear: null,
        priceUsd: null,
      });
      const [billing] = await db
        .select()
        .from(billings)
        .where(eq(billings.id, paid?.billingId ?? ""));
      expect(billing).toMatchObject({ tokenId: USDC_TOKEN, amount: "600000000" });
    });

    test("its USD work orders pay automatically in USDC, and its NEAR ones don't", async () => {
      clock = new Date("2026-11-05T12:00:00.000Z");
      const usd = await active();
      expect((await service.get(await studio(), { id: usd.id })).autoPay).toEqual({
        tokenId: USDC_TOKEN,
      });
      const near = await active({ tokenId: "near", budgetAmount: (100n * NEAR).toString() });
      expect((await service.get(await studio(), { id: near.id })).autoPay).toBeNull();
    });

    test("a NEAR-priced request isn't paid automatically, and says to use a DAO proposal", async () => {
      strongEvidence();
      clock = new Date("2026-11-05T12:00:00.000Z");
      const wo = await active({ tokenId: "near", budgetAmount: (100n * NEAR).toString() });
      const { submitted } = await submit(wo.id, { amount: (5n * NEAR).toString() });
      const approved = await service.approveRequest(await studio(), {
        requestId: submitted.id,
        amount: (5n * NEAR).toString(),
      });
      expect(approved.status).toBe("approved");
      const result = await service
        .payNow(await studio(), { requestId: submitted.id })
        .catch((error: Error) => error);
      expect(result instanceof Error ? result.message : "").toMatch(
        /pays in USDC, so only work orders priced in USD are paid automatically/,
      );
      expect(double.requests()).toEqual([]);
    });
  });
});
