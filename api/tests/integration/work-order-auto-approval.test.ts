import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { compensationRequests, notifications, workOrders } from "../../src/db/schema";
import {
  createPayoutAgents,
  type PayoutAgents,
  workOrderPayees,
} from "../../src/services/payouts/service";
import type { ConsistencyResult } from "../../src/services/work-orders/consistency";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import {
  type BuilderProfile,
  createWorkOrdersService,
} from "../../src/services/work-orders/service";
import { DEFAULT_RENEWAL } from "../../src/services/work-orders/types";
import { FakeAgentApi } from "../fakes/agent-api";
import { type EngagementWorld, engagementWorld, refused } from "../fakes/engagements";
import { FakeGitHub } from "../fakes/github";
import { signedIn } from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

const DAO = "studio.sputnik-dao.testnet";
const REPO = "studio/app";
const EMPTY_REPO = "studio/empty";
const CAROL = "carol.near";
const HOUR_MS = 3_600_000;
const CONSISTENT: ConsistencyResult = { verdict: "consistent", concerns: [], confidence: 0.9 };

describe("work order trust tiers and automatic approval", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let world: EngagementWorld;
  let github: FakeGitHub;
  let clock: Date;
  let agent: FakeAgentApi;
  let payouts: PayoutAgents;
  let verdict: ConsistencyResult | null | Error;
  let checks: number;
  let service: ReturnType<typeof createWorkOrdersService>;

  beforeEach(async () => {
    db = database.db;
    world = await engagementWorld(db);
    github = new FakeGitHub()
      .addRepo(REPO, { admins: ["maint-gh", "admin-gh"] })
      .addRepo(EMPTY_REPO, { admins: ["maint-gh", "admin-gh"] });
    clock = new Date("2026-09-20T12:00:00.000Z");
    verdict = CONSISTENT;
    checks = 0;
    agent = new FakeAgentApi();
    payouts = createPayoutAgents({
      db,
      api: agent,
      secretKey: "test-secret",
      payees: workOrderPayees(db),
      now: () => clock,
    });
    const builders = new Map<string, BuilderProfile>([
      [CAROL, { nearAccount: CAROL, name: "Carol", githubLogin: "carol-gh", userId: "carol" }],
    ]);
    service = createWorkOrdersService({
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
      proposalBond: async () => "100000000000000000000000",
      prices: { price: async () => ({ priceUsd: "4.99", at: "2026-09-20T12:00:00.000Z" }) },
      summarizer: { draftReport: async () => null },
      notifications: world.notifications,
      thresholds: DEFAULT_RENEWAL,
      payouts,
      consistency: {
        check: async () => {
          checks += 1;
          if (verdict instanceof Error) throw verdict;
          return verdict;
        },
      },
      now: () => clock,
    });
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

  async function setUpAgent() {
    await payouts.saveSettings("studio", "studio-admin", {
      ownerAccountId: "rita.near",
      monthlyBudgetUsd: "5000",
      maxPayoutNear: "500",
    });
    const create = await payouts.prepare("studio", {
      action: "create_agent",
      publicKey: `ed25519:${"1".repeat(44)}`,
    });
    await payouts.submit("studio", {
      correlationId: create.correlationId,
      signedData: await agent.sign(create.intent),
    });
    const grant = await payouts.prepare("studio", { action: "issue_grant" });
    await payouts.submit("studio", {
      correlationId: grant.correlationId,
      signedData: await agent.sign(grant.intent),
    });
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

  test("trust settings default to suggest and are saved per agency", async () => {
    expect(await service.trustSettings(await studio())).toEqual({ mode: "suggest", vetoHours: 24 });
    await automatic(12);
    expect(await service.trustSettings(await studio())).toEqual({ mode: "auto", vetoHours: 12 });
  });

  test("a new builder's request waits for an admin, showing the tier and blockers", async () => {
    await automatic();
    strongEvidence();
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.trust).toBeNull();
    const request = await admin();
    expect(request.trust).toMatchObject({
      tier: "new",
      decision: "manual",
      suggested: "manual",
      aiVerdict: "consistent",
      autoApproveAt: null,
      stopped: false,
    });
    expect(request.trust?.blockers).toContain(
      "The payee account has never been paid by this agency",
    );
    expect(await kindsOf("studio-admin")).toContain("compensation_request_submitted");
    expect((await service.mineGet(carol(), { id: wo.id })).requests[0]?.trust).toBeNull();
  });

  test("an established builder is approved after the veto window and paid by the agent", async () => {
    await paidHistory(2);
    await automatic();
    const wo = await active();
    const { admin } = await submit(wo.id);
    const waiting = await admin();
    expect(waiting.status).toBe("submitted");
    expect(waiting.trust).toMatchObject({
      tier: "established",
      decision: "veto_window",
      blockers: [],
      autoApproveAt: new Date(clock.getTime() + 24 * HOUR_MS).toISOString(),
    });
    expect(await kindsOf("studio-admin")).toContain("compensation_request_auto_scheduled");
    await setUpAgent();
    expect(await service.autoApproveDue()).toEqual({ approved: 0, manual: 0 });
    clock = new Date(clock.getTime() + 25 * HOUR_MS);
    expect(await service.autoApproveDue()).toEqual({ approved: 1, manual: 0 });
    const paid = await admin();
    expect(paid.status).toBe("paid");
    expect(paid.approvedBy).toBe("system");
    expect(paid.approvedAmount).toBe("600000000");
    expect(paid.trust?.approvedAutomatically).toBe(true);
    expect(agent.withdrawals).toHaveLength(1);
    expect(await kindsOf("studio-admin")).toContain("compensation_request_auto_approved");
  });

  test("the scheduled run approves due requests too", async () => {
    await paidHistory(2);
    await automatic(1);
    const wo = await active();
    const { admin } = await submit(wo.id);
    clock = new Date(clock.getTime() + 2 * HOUR_MS);
    const result = await service.run("job");
    expect(result.counts.autoApproved).toBe(1);
    expect((await admin()).status).toBe("approved");
  });

  test("an admin can stop the automatic approval", async () => {
    await paidHistory(2);
    await automatic();
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    const stopped = await service.stopAutoApproval(await studio(), { requestId: submitted.id });
    expect(stopped.trust).toMatchObject({ stopped: true, autoApproveAt: null, decision: "manual" });
    await refused(
      service.stopAutoApproval(await studio(), { requestId: submitted.id }),
      "NOT_SCHEDULED",
    );
    clock = new Date(clock.getTime() + 48 * HOUR_MS);
    expect(await service.autoApproveDue()).toEqual({ approved: 0, manual: 0 });
    expect((await admin()).status).toBe("submitted");
  });

  test("a request that is no longer clean at the end of the window falls back to an admin", async () => {
    await paidHistory(2);
    await automatic();
    const wo = await active();
    const { admin } = await submit(wo.id);
    verdict = { verdict: "concerns", concerns: ["The search feature has no PR"], confidence: 0.8 };
    clock = new Date(clock.getTime() + 25 * HOUR_MS);
    expect(await service.autoApproveDue()).toEqual({ approved: 0, manual: 1 });
    const request = await admin();
    expect(request.status).toBe("submitted");
    expect(request.trust).toMatchObject({ decision: "manual", autoApproveAt: null });
    expect(request.trust?.aiConcerns).toEqual(["The search feature has no PR"]);
    expect(await kindsOf("studio-admin")).toContain("compensation_request_needs_approval");
  });

  test("a trusted builder is approved and paid as soon as they submit", async () => {
    await paidHistory(4);
    clock = new Date("2026-11-05T12:00:00.000Z");
    await automatic();
    await setUpAgent();
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    expect(submitted.status).toBe("paid");
    const request = await admin();
    expect(request.approvedBy).toBe("system");
    expect(request.trust).toMatchObject({
      tier: "trusted",
      decision: "auto_pay",
      approvedAutomatically: true,
    });
    expect(agent.withdrawals).toHaveLength(1);
    expect(await kindsOf("studio-admin")).toContain("compensation_request_auto_approved");
  });

  test("no evidence for the period forces manual approval", async () => {
    await paidHistory(2);
    await automatic();
    const wo = await active({ repos: [EMPTY_REPO] });
    const { admin } = await submit(wo.id);
    const request = await admin();
    expect(request.trust?.tier).toBe("established");
    expect(request.trust?.decision).toBe("manual");
    expect(request.trust?.blockers).toContain("No authorized evidence for this period");
  });

  test("an inconsistent AI verdict forces manual approval", async () => {
    await paidHistory(2);
    await automatic();
    verdict = {
      verdict: "inconsistent",
      concerns: ["Claims a release the evidence doesn't show"],
      confidence: 0.9,
    };
    const wo = await active();
    const { admin } = await submit(wo.id);
    const request = await admin();
    expect(request.trust).toMatchObject({
      tier: "established",
      decision: "manual",
      aiVerdict: "inconsistent",
      aiConcerns: ["Claims a release the evidence doesn't show"],
    });
    expect(request.trust?.blockers).toContain(
      "The AI consistency check found the report inconsistent with the evidence",
    );
  });

  test("covered dates overlapping a paid request force manual approval", async () => {
    const history = await paidHistory(2);
    await automatic();
    const { admin } = await submit(history.id, {
      coversFrom: "2026-09-05",
      coversTo: "2026-09-10",
      amount: "100000000",
    });
    const request = await admin();
    expect(request.trust?.decision).toBe("manual");
    expect(request.trust?.blockers).toContain(
      `Covered dates overlap with ${history.code}-R1, ${history.code}-R2`,
    );
  });

  test("suggest mode stores the suggestion but leaves approval to an admin", async () => {
    await paidHistory(2);
    const wo = await active();
    const { admin } = await submit(wo.id);
    const request = await admin();
    expect(request.trust).toMatchObject({
      tier: "established",
      suggested: "veto_window",
      decision: "manual",
      autoApproveAt: null,
    });
    expect(await kindsOf("studio-admin")).not.toContain("compensation_request_auto_scheduled");
  });

  test("off mode skips the AI check", async () => {
    await integrations().saveTrust("studio", "studio-admin", { mode: "off", vetoHours: 24 });
    strongEvidence();
    const wo = await active();
    await submit(wo.id);
    expect(checks).toBe(0);
  });

  test("a failing consistency check doesn't break the submit and leaves it manual", async () => {
    await paidHistory(2);
    await automatic();
    verdict = new Error("model down");
    const wo = await active();
    const { submitted, admin } = await submit(wo.id);
    expect(submitted.status).toBe("submitted");
    const request = await admin();
    expect(request.trust?.decision).toBe("manual");
    expect(request.trust?.aiVerdict).toBeNull();
    expect(request.trust?.blockers).toContain("The AI consistency check is unavailable");
  });
});
