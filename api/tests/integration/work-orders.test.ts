import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { billings, notifications, workOrders } from "../../src/db/schema";
import { requireTreasury } from "../../src/services/organization-access";
import type { DaoProposal } from "../../src/services/sputnik";
import { contains, longDate, normalizeText } from "../../src/services/work-orders/documents";
import type { WorkOrderEvent } from "../../src/services/work-orders/events";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import {
  type BuilderProfile,
  createWorkOrdersService,
  repoOf,
} from "../../src/services/work-orders/service";
import type { ReportDraft } from "../../src/services/work-orders/summarizer";
import { DEFAULT_RENEWAL } from "../../src/services/work-orders/types";
import { type EngagementWorld, engagementWorld, refused } from "../fakes/engagements";
import { FakeGitHub } from "../fakes/github";
import { FakeGoogle } from "../fakes/google";
import { signedIn } from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

const DAO = "studio.sputnik-dao.testnet";
const REPO = "studio/app";
const USDC = "usdc.fakes.testnet";
const CAROL = "carol.near";

describe("work orders", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let world: EngagementWorld;
  let github: FakeGitHub;
  let clock: Date;
  let proposals: Map<string, DaoProposal>;
  let events: WorkOrderEvent[];
  let aiDraft: ReportDraft | null;
  let google: FakeGoogle;
  let builders: Map<string, BuilderProfile>;
  let service: ReturnType<typeof createWorkOrdersService>;

  beforeEach(async () => {
    db = database.db;
    world = await engagementWorld(db);
    github = new FakeGitHub().addRepo(REPO, { admins: ["maint-gh", "admin-gh"] });
    clock = new Date("2026-09-20T12:00:00.000Z");
    proposals = new Map();
    events = [];
    aiDraft = null;
    google = new FakeGoogle([
      "work_order_id",
      "project",
      "contractor_name",
      "representative_name",
      "period_start",
      "period_end",
      "budget_usd",
      "payee_account",
      "contractor_github",
      "repos",
      "effective_date",
    ]);
    builders = new Map([
      [CAROL, { nearAccount: CAROL, name: "Carol", githubLogin: "carol-gh", userId: "carol" }],
      [
        "nogit.near",
        { nearAccount: "nogit.near", name: "No Git", githubLogin: null, userId: "nogit" },
      ],
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
      proposal: async (dao, id) => proposals.get(`${dao}#${id}`) ?? null,
      proposalBond: async () => "100000000000000000000000",
      outbox: {
        enqueue: async (_organizationId, _workOrderId, event) => {
          events.push(event);
        },
      },
      summarizer: { draftReport: async () => aiDraft },
      google,
      userEmail: async (userId) => `${userId}@example.com`,
      appOrigin: "https://app.example",
      notifications: world.notifications,
      thresholds: DEFAULT_RENEWAL,
      now: () => clock,
    });
  });

  const studio = () => world.manager("studio-admin", "studio");
  const member = () => world.member("studio-admin", "studio");
  const carol = () => signedIn("carol", null, CAROL);
  const stranger = () => signedIn("mallory", null, "mallory.near");

  const fields = (over: Record<string, unknown> = {}) => ({
    projectId: "p1",
    builderNearAccount: CAROL,
    title: "Contributor role",
    repos: [REPO],
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    tokenId: USDC,
    budgetAmount: "1000000000",
    ...over,
  });

  async function active(over: Record<string, unknown> = {}) {
    const created = await service.create(await studio(), fields(over));
    await service.offer(await studio(), { id: created.id });
    const mine = await service.mineGet(carol(), { id: created.id });
    await service.accept(carol(), { id: created.id, termsHash: mine.termsHash });
    const prior = clock;
    clock = new Date("2026-08-31T12:00:00.000Z");
    const activated = await service.activate(await studio(), { id: created.id });
    clock = prior;
    return activated;
  }

  function strongEvidence() {
    for (let w = 0; w < 4; w++) {
      const d = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;
      github
        .issue(REPO, 100 + w)
        .assign("carol-gh", `${d(1 + w * 7)}T10:00:00Z`)
        .close(`${d(3 + w * 7)}T13:00:00Z`);
      github.pull(REPO, 200 + w, {
        author: "carol-gh",
        createdAt: `${d(1 + w * 7)}T12:00:00Z`,
        mergedAt: `${d(3 + w * 7)}T12:00:00Z`,
        closes: [100 + w],
      });
    }
  }

  function transfer(
    id: number,
    over: Partial<{
      receiverId: string;
      amount: string;
      tokenId: string;
      status: DaoProposal["status"];
    }> = {},
  ) {
    proposals.set(`${DAO}#${id}`, {
      id,
      proposer: "studio-admin.near",
      description: "Pay Carol",
      kind: {
        type: "Transfer",
        tokenId: over.tokenId ?? USDC,
        receiverId: over.receiverId ?? CAROL,
        amount: over.amount ?? "600000000",
      },
      status: over.status ?? "InProgress",
      submissionTime: "0",
      votes: {},
    });
  }

  async function notificationsOf(userId: string) {
    return db.select().from(notifications).where(eq(notifications.recipientUserId, userId));
  }

  describe("lifecycle", () => {
    test("draft → offered → accepted by the builder's own account → active", async () => {
      const created = await service.create(await studio(), fields());
      expect(created.code).toBe("WO-0001");
      expect(created.status).toBe("draft");
      expect(created.activationBlockers).toContain(
        "Offer it to the builder, or have the work order document e-signed",
      );
      expect((await service.mine(carol())).data).toEqual([]);

      await service.offer(await studio(), { id: created.id });
      expect((await notificationsOf("carol")).map((n) => n.kind)).toEqual(["work_order_offered"]);
      const mine = await service.mineGet(carol(), { id: created.id });
      expect(mine.agencyName).toBe("Studio");
      await refused(
        service.accept(carol(), { id: created.id, termsHash: "0".repeat(64) }),
        "TERMS_CHANGED",
      );
      const accepted = await service.accept(carol(), { id: created.id, termsHash: mine.termsHash });
      expect(accepted.status).toBe("accepted");

      const activated = await service.activate(await studio(), { id: created.id });
      expect(activated.status).toBe("active");
      expect(activated.builder.githubLogin).toBe("carol-gh");
      expect((await notificationsOf("carol")).map((n) => n.kind)).toContain("work_order_activated");
    });

    test("another account can't see or accept the work order", async () => {
      const created = await service.create(await studio(), fields());
      await service.offer(await studio(), { id: created.id });
      await refused(service.mineGet(stranger(), { id: created.id }), "NOT_FOUND");
      await refused(
        service.accept(stranger(), { id: created.id, termsHash: "0".repeat(64) }),
        "NOT_FOUND",
      );
    });

    test("changing the terms after acceptance sends it back to draft", async () => {
      const created = await service.create(await studio(), fields());
      await service.offer(await studio(), { id: created.id });
      const mine = await service.mineGet(carol(), { id: created.id });
      await service.accept(carol(), { id: created.id, termsHash: mine.termsHash });
      const edited = await service.update(await studio(), {
        id: created.id,
        budgetAmount: "2000000000",
      });
      expect(edited.status).toBe("draft");
      expect(edited.acceptedAt).toBeNull();
    });

    test("a builder without a GitHub login can't be activated", async () => {
      const created = await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near" }),
      );
      await service.offer(await studio(), { id: created.id });
      const mine = await service.mineGet(signedIn("nogit", null, "nogit.near"), { id: created.id });
      await service.accept(signedIn("nogit", null, "nogit.near"), {
        id: created.id,
        termsHash: mine.termsHash,
      });
      await refused(service.activate(await studio(), { id: created.id }), "ACTIVATION_BLOCKED");
      const blocked = await service.get(await studio(), { id: created.id });
      expect(blocked.activationBlockers).toContain("Add the builder's GitHub login");
      const fixed = await service.setGithubLogin(await studio(), {
        id: created.id,
        githubLogin: "@NoGit-GH",
      });
      expect(fixed.builder.githubLogin).toBe("nogit-gh");
      expect(fixed.status).toBe("accepted");
      expect(fixed.termsChanged).toBe(false);
      await refused(
        service.setGithubLogin(await studio(), { id: created.id, githubLogin: "other" }),
        "GITHUB_LOGIN_SET",
      );
      clock = new Date("2026-08-31T12:00:00.000Z");
      expect((await service.activate(await studio(), { id: created.id })).status).toBe("active");
    });

    test("only managers write; members read; other agencies see nothing", async () => {
      const created = await service.create(await studio(), fields());
      expect((await service.list(await member())).data.map((w) => w.id)).toEqual([created.id]);
      const rival = await world.manager("rival-admin", "rival");
      await refused(service.get(rival, { id: created.id }), "NOT_FOUND");
    });

    test("codes are unique per agency; unknown builders and bad repos are refused", async () => {
      await service.create(await studio(), fields({ code: "SI-001" }));
      await refused(service.create(await studio(), fields({ code: "SI-001" })), "CODE_TAKEN");
      await refused(
        service.create(await studio(), fields({ builderNearAccount: "ghost.near" })),
        "UNKNOWN_BUILDER",
      );
      await refused(
        service.create(await studio(), fields({ repos: ["not a repo"] })),
        "INVALID_REPO",
      );
    });

    test("repoOf reads GitHub URLs and owner/name", () => {
      expect(repoOf("https://github.com/Acme/App.git")).toBe("Acme/App");
      expect(repoOf("acme/app")).toBe("acme/app");
      expect(repoOf("https://gitlab.com/acme/app")).toBeNull();
    });
  });

  describe("evidence: the repository owner accepts", () => {
    test("a PR merged by a repo admin counts; one merged by a writer doesn't", async () => {
      github.issue(REPO, 1).assign("carol-gh", "2026-09-02T10:00:00Z");
      github.issue(REPO, 2).assign("carol-gh", "2026-09-02T10:00:00Z");
      github.pull(REPO, 11, {
        author: "carol-gh",
        createdAt: "2026-09-03T10:00:00Z",
        mergedAt: "2026-09-04T10:00:00Z",
        closes: [1],
      });
      github.pull(REPO, 12, {
        author: "carol-gh",
        createdAt: "2026-09-03T10:00:00Z",
        mergedAt: "2026-09-04T10:00:00Z",
        mergedBy: "writer-gh",
        closes: [2],
      });
      const wo = await active();
      const detail = await service.collect(await studio(), { id: wo.id });
      const pr11 = detail.evidence.find((e) => e.url.endsWith("/pull/11"))!;
      const pr12 = detail.evidence.find((e) => e.url.endsWith("/pull/12"))!;
      expect(pr11.authorized).toBe(true);
      expect(pr12.authorized).toBe(false);
      expect(pr12.flags[0]).toContain("not approved by the repository owner");
      expect(detail.repoOwners).toEqual([
        {
          repo: REPO,
          owner: "studio",
          ownerType: "Organization",
          approvers: ["maint-gh", "admin-gh"],
          error: null,
        },
      ]);
    });

    test("a user's repository: only that user accepts", async () => {
      github.addRepo("carol-owner/site", { userOwner: "owner-gh" });
      github.issue("carol-owner/site", 1).assign("carol-gh", "2026-09-02T10:00:00Z", "owner-gh");
      github.pull("carol-owner/site", 5, {
        author: "carol-gh",
        createdAt: "2026-09-03T10:00:00Z",
        mergedAt: "2026-09-04T10:00:00Z",
        closes: [1],
      });
      const wo = await active({ repos: ["carol-owner/site"] });
      const detail = await service.collect(await studio(), { id: wo.id });
      expect(detail.evidence.find((e) => e.url.endsWith("/pull/5"))?.authorized).toBe(false);
      expect(detail.repoOwners[0]?.approvers).toEqual(["owner-gh"]);
    });

    test("an owner read failure is shown on the work order, not thrown", async () => {
      const wo = await active();
      github.failNext("getRepoOwnership", new Error("no access to collaborators"));
      const detail = await service.get(await studio(), { id: wo.id });
      expect(detail.repoOwners[0]?.error).toContain("no access to collaborators");
    });
  });

  describe("compensation requests and payment through the Agency DAO", () => {
    async function submitted() {
      strongEvidence();
      const wo = await active();
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      expect(draft.code).toBe("WO-0001-R1");
      expect(draft.requestedAmount).toBe("1000000000");
      await service.editRequest(carol(), {
        requestId: draft.id,
        assessmentMd: "Shipped search.",
        requestedAmount: "600000000",
        manualItems: [
          {
            title: "Research note",
            url: "https://docs.example/research",
            date: "2026-09-05",
            note: null,
          },
        ],
      });
      const done = await service.submitRequest(carol(), { requestId: draft.id });
      return { wo, request: done };
    }

    test("submit freezes the report with its hash and tells the managers", async () => {
      const { request } = await submitted();
      expect(request.status).toBe("submitted");
      expect(request.reportSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(request.reportMd).toContain("# Compensation Request WO-0001-R1");
      expect(request.reportMd).toContain("Research note");
      expect(request.reportMd).toContain(`report sha256 ${request.reportSha256}`);
      const kinds = (await notificationsOf("studio-admin")).map((n) => n.kind);
      expect(kinds).toContain("compensation_request_submitted");
      await refused(
        service.editRequest(carol(), { requestId: request.id, assessmentMd: "x" }),
        "SUBMITTED",
      );
    });

    test("approve is capped by the budget; the proposal must match payee, token and amount", async () => {
      const { request } = await submitted();
      await refused(
        service.approveRequest(await studio(), { requestId: request.id, amount: "1000000001" }),
        "OVER_BUDGET",
      );
      const approved = await service.approveRequest(await studio(), {
        requestId: request.id,
        amount: "600000000",
      });
      expect(approved.status).toBe("approved");
      const treasury = requireTreasury(await studio());
      transfer(7, { receiverId: "mallory.near" });
      await refused(
        service.linkProposal(treasury, { requestId: request.id, proposalId: "7" }),
        "WRONG_RECEIVER",
      );
      transfer(8, { amount: "1" });
      await refused(
        service.linkProposal(treasury, { requestId: request.id, proposalId: "8" }),
        "WRONG_AMOUNT",
      );
      transfer(9, { tokenId: "near" });
      await refused(
        service.linkProposal(treasury, { requestId: request.id, proposalId: "9" }),
        "WRONG_TOKEN",
      );
      transfer(10);
      const linked = await service.linkProposal(treasury, {
        requestId: request.id,
        proposalId: "10",
      });
      expect(linked.status).toBe("proposed");
      const [billing] = await db.select().from(billings).where(eq(billings.proposalId, "10"));
      expect(billing).toMatchObject({
        projectId: "p1",
        nearAccount: CAROL,
        tokenId: USDC,
        amount: "600000000",
        payingDaoAccountId: DAO,
      });
      await refused(
        service.linkProposal(treasury, { requestId: request.id, proposalId: "10" }),
        "NOT_APPROVED",
      );
    });

    test("an approved proposal pays the request; a full budget exhausts the work order", async () => {
      const { wo, request } = await submitted();
      await service.approveRequest(await studio(), { requestId: request.id, amount: "1000000000" });
      transfer(11, { amount: "1000000000" });
      await service.linkProposal(requireTreasury(await studio()), {
        requestId: request.id,
        proposalId: "11",
      });
      transfer(11, { amount: "1000000000", status: "Approved" });
      const paid = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(paid.status).toBe("paid");
      expect(paid.reportMd).toContain("## Payment");
      expect(paid.reportMd).toContain(`DAO proposal ${DAO} #11`);
      const after = await service.get(await studio(), { id: wo.id });
      expect(after.status).toBe("exhausted");
      expect(after.paidAmount).toBe("1000000000");
      expect((await notificationsOf("carol")).map((n) => n.kind)).toContain(
        "compensation_request_paid",
      );
    });

    test("a rejected or expired proposal frees the budget", async () => {
      const { wo, request } = await submitted();
      await service.approveRequest(await studio(), { requestId: request.id, amount: "600000000" });
      transfer(12);
      await service.linkProposal(requireTreasury(await studio()), {
        requestId: request.id,
        proposalId: "12",
      });
      expect((await service.get(await studio(), { id: wo.id })).remainingAmount).toBe("400000000");
      transfer(12, { status: "Expired" });
      const failed = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(failed.status).toBe("failed");
      expect((await service.get(await studio(), { id: wo.id })).remainingAmount).toBe("1000000000");
    });

    test("builds the DAO transfer proposal that linking accepts", async () => {
      const { request } = await submitted();
      await expect(
        service.paymentProposal(requireTreasury(await studio()), { requestId: request.id }),
      ).rejects.toThrow(/Approve the request/);
      await service.approveRequest(await studio(), { requestId: request.id, amount: "600000000" });
      const tx = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: request.id,
      });
      expect(tx.daoAccountId).toBe(DAO);
      expect(tx.deposit).toBe("100000000000000000000000");
      expect(tx.args.proposal.kind.Transfer).toEqual({
        token_id: USDC,
        receiver_id: CAROL,
        amount: "600000000",
        msg: null,
      });
      expect(tx.args.proposal.description).toContain(`${request.code.split("-R")[0]}-R1`);
      const t = tx.args.proposal.kind.Transfer;
      transfer(13, { tokenId: t.token_id, receiverId: t.receiver_id, amount: t.amount });
      const linked = await service.linkProposal(requireTreasury(await studio()), {
        requestId: request.id,
        proposalId: "13",
      });
      expect(linked.status).toBe("proposed");
    });

    test("reject tells the builder why", async () => {
      const { request } = await submitted();
      const rejected = await service.rejectRequest(await studio(), {
        requestId: request.id,
        note: "Missing docs",
      });
      expect(rejected.status).toBe("rejected");
      expect(rejected.note).toBe("Missing docs");
    });
  });

  describe("the scheduled run: period end, auto draft, monthly renewal", () => {
    test("ends the period, drafts the request and renews when every metric is met", async () => {
      strongEvidence();
      await active({ autoRenew: true });
      clock = new Date("2026-10-03T06:00:00.000Z");
      const result = await service.run();
      expect(result.ran).toBe(true);
      const all = (await service.list(await studio())).data;
      const parent = all.find((w) => w.code === "WO-0001")!;
      const child = all.find((w) => w.code === "WO-0001-M2")!;
      expect(parent.status).toBe("ended");
      expect(parent.renewal?.status).toBe("renewed");
      expect(parent.renewal?.decidedBy).toBe("auto");
      expect(child).toMatchObject({
        status: "active",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        renewedFrom: parent.id,
      });
      expect(
        (await service.get(await studio(), { id: parent.id })).requests.map((r) => r.status),
      ).toEqual(["draft"]);
      expect((await notificationsOf("carol")).map((n) => n.kind)).toEqual(
        expect.arrayContaining(["compensation_request_ready", "work_order_renewed"]),
      );
    });

    test("a missed metric needs manual approval; approve renews, decline doesn't", async () => {
      github.issue(REPO, 1).assign("carol-gh", "2026-09-02T10:00:00Z");
      await active({ autoRenew: true });
      clock = new Date("2026-10-03T06:00:00.000Z");
      await service.run();
      const parent = (await service.list(await studio())).data.find((w) => w.code === "WO-0001")!;
      expect(parent.renewal?.status).toBe("needs_approval");
      expect(parent.renewal?.assessment.metrics.filter((m) => !m.met).map((m) => m.key)).toEqual([
        "active_weeks",
        "approved_prs",
        "issues_done",
      ]);
      expect((await notificationsOf("studio-admin")).map((n) => n.kind)).toContain(
        "work_order_renewal_needs_approval",
      );
      const decided = await service.decideRenewal(await studio(), {
        id: parent.id,
        decision: "approve",
        note: "Slow month",
      });
      expect(decided.renewal?.status).toBe("renewed");
      expect(decided.renewal?.decidedBy).toBe("representative");
      await refused(
        service.decideRenewal(await studio(), { id: parent.id, decision: "decline" }),
        "RENEWAL_NOT_PENDING",
      );
    });

    test("without the clause the work order just ends; a second runner waits for the lock", async () => {
      await active();
      clock = new Date("2026-10-03T06:00:00.000Z");
      const [first, second] = await Promise.all([service.run("a"), service.run("b")]);
      expect([first.ran, second.ran].filter(Boolean).length).toBeGreaterThanOrEqual(1);
      const all = (await service.list(await studio())).data;
      expect(all.map((w) => w.code)).toEqual(["WO-0001"]);
      expect(all[0]?.status).toBe("ended");
      expect(all[0]?.renewal).toBeNull();
    });

    test("the run syncs proposed payments", async () => {
      strongEvidence();
      const wo = await active();
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      await service.submitRequest(carol(), { requestId: draft.id });
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      transfer(20);
      await service.linkProposal(requireTreasury(await studio()), {
        requestId: draft.id,
        proposalId: "20",
      });
      transfer(20, { status: "Approved" });
      const result = await service.run();
      expect(result.counts.paid).toBe(1);
      const [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
      expect(row?.status).toBe("active");
    });
  });
  describe("Google eSignature, payout account, emails", () => {
    const REAL_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

    const signedPdf = (over: Record<string, unknown> = {}) => ({
      method: "google_esign" as const,
      documentSha256: "a".repeat(64),
      documentUrl: "https://drive.google.com/file/d/signed/view",
      signedAt: "2026-08-30T10:00:00Z",
      signers: [
        { name: "Carol", role: "contractor" as const, signedAt: "2026-08-30T09:00:00Z" },
        { name: "Rita Rep", role: "representative" as const, signedAt: "2026-08-30T10:00:00Z" },
      ],
      extracted: {
        workOrderId: "WO-0001",
        project: "Project p1",
        contractorName: "Carol",
        representativeName: "Rita Rep",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        budgetUsd: "$1,000.00",
        payee: CAROL,
        contractorGithub: "@carol-gh",
        repos: [REPO],
        ...over,
      },
    });

    test("creating a draft sends the template terms, with both contacts", async () => {
      const created = await service.create(
        await studio(),
        fields({
          tokenId: REAL_USDC,
          representativeName: "Rita Rep",
          contractorEmail: "Carol@Example.com",
          ipModel: "assignment",
        }),
      );
      expect(created.builder.githubLogin).toBe("carol-gh");
      expect(created.contractorName).toBe("Carol");
      const event = events.find((e) => e.type === "work_order.created");
      expect(event?.workOrder.id).toBe("WO-0001");
      expect(event?.contractor).toEqual({
        name: "Carol",
        email: "carol@example.com",
        github: "carol-gh",
        nearAccount: CAROL,
      });
      expect(event?.representative).toEqual({
        name: "Rita Rep",
        email: "studio-admin@example.com",
      });
      expect(event?.terms).toMatchObject({
        budgetUsd: "1000",
        payee: CAROL,
        contractorGithub: "carol-gh",
        repos: [REPO],
        ipModel: "assignment",
        autoRenew: false,
      });
      expect(event?.links.review).toBe(`https://app.example/admin/work-orders/${created.id}`);
    });

    test("n8n records the filled document and the representative is told", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      const url = "https://docs.google.com/document/d/abc/edit";
      await service.preparedDocument("studio", { code: "wo-0001", preparedDocumentUrl: url });
      await service.prepareDocument(await studio(), { id: created.id });
      expect(events.filter((e) => e.type === "work_order.created")).toHaveLength(2);
      const ready = events.find((e) => e.type === "work_order.document_ready");
      expect(ready?.links.document).toBe(url);
      expect(
        (await service.get(await studio(), { id: created.id })).signature.preparedDocumentUrl,
      ).toBe(url);
      await refused(
        service.preparedDocument("rival", { code: "WO-0001", preparedDocumentUrl: url }),
        "NOT_FOUND",
      );
    });

    test("a signed PDF with different terms is refused and the differences are sent", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await expect(
        service.attachSignedDocument("studio", {
          code: "WO-0001",
          ...signedPdf({ budgetUsd: "1500", payee: "mallory.near" }),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const mismatch = events.find((e) => e.type === "work_order.signature_mismatch");
      expect(mismatch?.mismatches).toEqual([
        "budget: draft 1000, signed PDF 1500",
        'payout account: draft "carol.near", signed PDF "mallory.near"',
      ]);
      expect((await service.get(await studio(), { id: created.id })).status).toBe("draft");
    });

    test("a matching signed PDF signs it; a new payee confirms with their wallet first", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      const result = await service.attachSignedDocument("studio", {
        code: "WO-0001",
        ...signedPdf(),
      });
      expect(result).toEqual({ id: "WO-0001", status: "accepted", mismatches: [] });
      const again = await service.attachSignedDocument("studio", {
        code: "WO-0001",
        ...signedPdf(),
      });
      expect(again.mismatches).toEqual([]);
      expect(events.filter((e) => e.type === "work_order.signed")).toHaveLength(1);
      expect(events.map((e) => e.type)).toContain("work_order.confirm_payee");

      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.signature.method).toBe("google_esign");
      expect(signed.signature.signers.map((s) => s.role)).toEqual(["contractor", "representative"]);
      expect(signed.documentSha256).toBe("a".repeat(64));
      expect(signed.payee).toMatchObject({ paidBefore: false, needsConfirmation: true });
      expect(signed.activationBlockers.join(" ")).toMatch(/hasn't confirmed the payout account/);
      clock = new Date("2026-08-31T12:00:00.000Z");
      await refused(service.activate(await studio(), { id: created.id }), "ACTIVATION_BLOCKED");

      await refused(service.confirmPayee(stranger(), { id: created.id }), "NOT_FOUND");
      const confirmed = await service.confirmPayee(carol(), { id: created.id });
      expect(confirmed.payee.confirmedAt).not.toBeNull();
      expect(events.map((e) => e.type)).toContain("work_order.payee_confirmed");
      expect((await service.activate(await studio(), { id: created.id })).status).toBe("active");
      expect(events.map((e) => e.type)).toContain("work_order.active");
    });

    test("an account the Agency paid before needs no confirmation", async () => {
      await db.insert(billings).values({
        id: "b-old",
        projectId: "p2",
        nearAccount: CAROL,
        tokenId: USDC,
        amount: "5",
        proposalId: "3",
        payingDaoAccountId: DAO,
      });
      transfer(3, { status: "Approved" });
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await service.attachSignedDocument("studio", { code: "WO-0001", ...signedPdf() });
      expect(events.map((e) => e.type)).not.toContain("work_order.confirm_payee");
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.payee).toMatchObject({ paidBefore: true, needsConfirmation: false });
      clock = new Date("2026-08-31T12:00:00.000Z");
      expect((await service.activate(await studio(), { id: created.id })).status).toBe("active");
    });

    test("accepting in the app proves the payout account", async () => {
      const wo = await active();
      expect(wo.payee.confirmedAt).not.toBeNull();
      expect(wo.signature.method).toBe("in_app");
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining([
          "work_order.created",
          "work_order.offered",
          "work_order.signed",
          "work_order.active",
        ]),
      );
    });

    test("changing a signed term sends it back to draft and asks for a new document", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await service.attachSignedDocument("studio", { code: "WO-0001", ...signedPdf() });
      const changed = await service.update(await studio(), {
        id: created.id,
        budgetAmount: "2000000000",
      });
      expect(changed.status).toBe("draft");
      expect(changed.signature.method).toBeNull();
      expect(changed.documentSha256).toBeNull();
      expect(events.filter((e) => e.type === "work_order.created")).toHaveLength(2);
    });

    test("the drafted report uses the AI draft and goes to the builder", async () => {
      aiDraft = {
        summary: "Carol shipped the search feature.",
        assessment: {
          objectives: "Search unblocks onboarding.",
          lessons: "Small PRs merged faster.",
          challenges: "Flaky CI.",
          recommendations: "Add search tests.",
        },
      };
      strongEvidence();
      const wo = await active({ tokenId: REAL_USDC });
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      expect(draft.contributionsMd).toContain("Carol shipped the search feature.");
      expect(draft.assessmentMd).toContain("Search unblocks onboarding.");
      const edited = await service.editRequest(carol(), {
        requestId: draft.id,
        requestedAmount: "500000000",
      });
      expect(edited.contributionsMd).toContain("Carol shipped the search feature.");
      const ready = events.find((e) => e.type === "request.report_ready");
      expect(ready?.request?.id).toBe("WO-0001-R1");
      expect(ready?.reportMd).toContain("## Assessment");
      expect(ready?.links.contractor).toBe(`https://app.example/work-orders/${wo.id}`);
      await service.submitRequest(carol(), { requestId: draft.id });
      const waiting = events.find((e) => e.type === "request.awaiting_approval");
      expect(waiting?.request?.requested).toBe("500 USDC");
    });
  });
  describe("Google Docs and Drive, without n8n", () => {
    const REAL_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

    beforeEach(async () => {
      await createWorkOrderIntegrations({ db }).saveGoogle("studio", "studio-admin", {
        templateId: "tpl",
        documentsFolderId: "docs",
        signedFolderId: "signed",
      });
    });

    const signedLines = (documentId: string, over: Record<string, string> = {}) => {
      const v = { ...google.filled.get(documentId), ...over };
      return [
        `WORK ORDER ${v.work_order_id}`,
        `Effective ${v.effective_date}`,
        `Contractor: ${v.contractor_name}   Representative: ${v.representative_name}`,
        `Project: ${v.project}`,
        `Period: ${v.period_start} to ${v.period_end}`,
        `Budget: up to $${v.budget_usd}`,
        `Schedule A: payout account ${v.payee_account}, GitHub ${v.contractor_github}`,
        `Repositories: ${v.repos}`,
        "Signed by Carol and Rita Rep with Google eSignature",
      ];
    };

    test("a new work order gets its filled Google Doc and the representative is told", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      expect(google.copies).toEqual([
        {
          templateId: "tpl",
          name: "Work Order WO-0001: Contributor role",
          parentId: "docs",
          id: "doc-1",
        },
      ]);
      const values = google.filled.get("doc-1");
      expect(values).toMatchObject({
        work_order_id: "WO-0001",
        project: "Project p1",
        contractor_name: "Carol",
        representative_name: "Rita Rep",
        period_start: "September 1, 2026",
        period_end: "September 30, 2026",
        budget_usd: "1000",
        payee_account: CAROL,
        contractor_github: "carol-gh",
        repos: REPO,
      });
      expect(created.signature.preparedDocumentUrl).toBe(
        "https://docs.google.com/document/d/doc-1/edit",
      );
      expect(events.map((e) => e.type)).toEqual(["work_order.document_ready"]);
    });

    test("a signed PDF in the Signed folder signs the matching work order, once", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      google.addPdf("signed", "pdf-1", signedLines("doc-1"));
      google.addPdf("elsewhere", "pdf-x", signedLines("doc-1"));
      const result = await service.checkDrive(await studio());
      expect(result).toEqual({ checked: 1, attached: 1, mismatch: 0, unmatched: 0, error: 0 });
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.status).toBe("accepted");
      expect(signed.signature.method).toBe("google_esign");
      expect(signed.documentUrl).toBe("https://drive.google.com/file/d/pdf-1/view");
      expect(signed.documentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining(["work_order.signed", "work_order.confirm_payee"]),
      );
      expect((await service.checkDrive(await studio())).checked).toBe(0);
    });

    test("a signed PDF with different terms isn't attached and the differences are sent", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      google.addPdf(
        "signed",
        "pdf-2",
        signedLines("doc-1", { budget_usd: "10000", payee_account: "mallory.near" }),
      );
      expect((await service.checkDrive(await studio())).mismatch).toBe(1);
      expect((await service.get(await studio(), { id: created.id })).status).toBe("draft");
      expect(events.find((e) => e.type === "work_order.signature_mismatch")?.mismatches).toEqual([
        'budget: "1000" isn\'t in the signed PDF',
        'payout account: "carol.near" isn\'t in the signed PDF',
      ]);
      expect((await service.checkDrive(await studio())).checked).toBe(0);
    });

    test("PDFs that match nothing are noted; a failed download is tried again", async () => {
      await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      google.addPdf("signed", "pdf-3", ["An unrelated contract"]);
      google.addPdf("signed", "pdf-4", signedLines("doc-1"));
      google.failDownloads.add("pdf-4");
      expect(await service.checkDrive(await studio())).toEqual({
        checked: 2,
        attached: 0,
        mismatch: 0,
        unmatched: 1,
        error: 1,
      });
      google.failDownloads.clear();
      expect(await service.checkDrive(await studio())).toMatchObject({ checked: 1, attached: 1 });
    });

    test("changing a term fills a new document", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await service.update(await studio(), { id: created.id, budgetAmount: "2000000000" });
      expect(google.copies.map((c) => c.id)).toEqual(["doc-1", "doc-2"]);
      expect(google.filled.get("doc-2")?.budget_usd).toBe("2000");
      google.addPdf("signed", "pdf-old", signedLines("doc-1"));
      expect((await service.checkDrive(await studio())).mismatch).toBe(1);
    });

    test("matching is exact: a value must stand on its own in the PDF", () => {
      expect(longDate("2026-09-01")).toBe("September 1, 2026");
      const text = normalizeText(
        "Budget: up to $10000. Paid to carol.near.\nRepos: studio/app, studio/api",
      );
      expect(contains(text, "1000")).toBe(false);
      expect(contains(text, "10000")).toBe(true);
      expect(contains(text, "carol.near")).toBe(true);
      expect(contains(text, "arol.near")).toBe(false);
      expect(contains(text, "studio/app")).toBe(true);
    });
  });
});
