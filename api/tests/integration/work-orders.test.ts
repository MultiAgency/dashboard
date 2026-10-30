import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib/dist/pdf-lib.esm.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Database } from "../../src/db";
import {
  billings,
  compensationRequests,
  notifications,
  organizationBuilderLogins,
  workOrderDocuments,
  workOrderDriveFiles,
  workOrderIntegrations,
  workOrderOutbox,
  workOrders,
} from "../../src/db/schema";
import { rememberedLogin } from "../../src/services/builder-logins";
import { requireTreasury } from "../../src/services/organization-access";
import { atomicToNear, topUpFor } from "../../src/services/payouts/policy";
import {
  createPayoutAgents,
  type PayoutAgents,
  workOrderPayees,
} from "../../src/services/payouts/service";
import type { DaoProposal } from "../../src/services/sputnik";
import { enrichWithChainStatus } from "../../src/services/sputnik";
import {
  contains,
  documentFields,
  longDate,
  normalizeText,
  pdfText,
} from "../../src/services/work-orders/documents";
import { composeEmails } from "../../src/services/work-orders/emails";
import type { WorkOrderEvent } from "../../src/services/work-orders/events";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import { usdToTokens } from "../../src/services/work-orders/prices";
import { scheduleWorkOrders, stopWorkOrders } from "../../src/services/work-orders/scheduler";
import {
  type BuilderProfile,
  createWorkOrdersService,
  repoOf,
} from "../../src/services/work-orders/service";
import { fromBase64 } from "../../src/services/work-orders/signing";
import type { ReportDraft } from "../../src/services/work-orders/summarizer";
import { DEFAULT_RENEWAL } from "../../src/services/work-orders/types";
import { FakeAgentApi } from "../fakes/agent-api";
import { FakeDocumenso } from "../fakes/documenso";
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
  let priceUsd: string;
  let builders: Map<string, BuilderProfile>;
  let service: ReturnType<typeof createWorkOrdersService>;
  let serviceDeps: Parameters<typeof createWorkOrdersService>[0];

  beforeEach(async () => {
    db = database.db;
    world = await engagementWorld(db);
    github = new FakeGitHub().addRepo(REPO, { admins: ["maint-gh", "admin-gh"] });
    clock = new Date("2026-09-20T12:00:00.000Z");
    proposals = new Map();
    events = [];
    aiDraft = null;
    priceUsd = "4.99";
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
    serviceDeps = {
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
      proposal: async (dao, id) => proposals.get(`${dao}#${id}`) ?? null,
      proposalBond: async () => "100000000000000000000000",
      prices: { price: async () => ({ priceUsd, at: "2026-09-20T12:00:00.000Z" }) },
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
    };
    service = createWorkOrdersService(serviceDeps);
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

  async function signAsBuilder(id: string, who = carol(), name = "Carol") {
    const doc = await service.myDocument(who, { id });
    return service.sign(
      who,
      { id, documentSha256: doc.sha256, name },
      {
        ip: "203.0.113.7",
        userAgent: "Vitest",
      },
    );
  }

  async function active(over: Record<string, unknown> = {}) {
    const created = await service.create(await studio(), fields(over));
    await service.offer(await studio(), { id: created.id });
    await signAsBuilder(created.id);
    const prior = clock;
    clock = new Date("2026-08-31T12:00:00.000Z");
    const activated = await service.countersign(await studio(), {
      id: created.id,
      name: "Rita Rep",
    });
    clock = prior;
    expect(activated.status).toBe("active");
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
    test("the next code previews the auto-numbered code without taking it", async () => {
      expect(await service.nextCode(await studio())).toEqual({ code: "WO-0001" });
      expect(await service.nextCode(await studio())).toEqual({ code: "WO-0001" });
      await service.create(await studio(), fields());
      await service.create(await studio(), fields({ code: "SI-004" }));
      expect(await service.nextCode(await studio())).toEqual({ code: "WO-0002" });
      expect((await service.create(await studio(), fields())).code).toBe("WO-0002");
    });

    test("timestamps follow the service clock, so a new draft is waiting since now", async () => {
      const created = await service.create(await studio(), fields());
      expect(created.createdAt).toBe("2026-09-20T12:00:00.000Z");
      expect(created.progress.since).toBe("2026-09-20T12:00:00.000Z");
    });

    test("a project that can't be found shows as unknown, never as its id", async () => {
      const created = await service.create(await studio(), fields());
      await db
        .update(workOrders)
        .set({ projectId: "proj_gone", projectTitle: null, projectSlug: null })
        .where(eq(workOrders.id, created.id));
      const view = await service.get(await studio(), { id: created.id });
      expect(view.projectId).toBe("proj_gone");
      expect(view.projectTitle).toBe("Unknown project");
    });

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
        service.sign(carol(), { id: created.id, documentSha256: "0".repeat(64), name: "Carol" }),
        "DOCUMENT_CHANGED",
      );
      const accepted = await signAsBuilder(created.id);
      expect(accepted.status).toBe("accepted");
      expect(accepted.signing.builder?.name).toBe("Carol");
      expect(accepted.activationBlockers).toContain("Countersign the work order");
      await refused(service.activate(await studio(), { id: created.id }), "ACTIVATION_BLOCKED");
      const activated = await service.countersign(await studio(), {
        id: created.id,
        name: "Rita Rep",
      });
      expect(activated.signing.needsCountersign).toBe(false);
      expect(activated.activationBlockers).toEqual([]);
      expect(activated.status).toBe("active");
      await refused(service.activate(await studio(), { id: created.id }), "NOT_ACCEPTED");
      expect(activated.builder.githubLogin).toBe("carol-gh");
      expect((await notificationsOf("carol")).map((n) => n.kind)).toContain("work_order_activated");
    });

    test("counts the work orders that need the agency, from the list's progress", async () => {
      expect(await service.needsYouCount(await member())).toEqual({ count: 0 });
      const first = await service.create(await studio(), fields());
      await service.create(await studio(), fields({ title: "Second role" }));
      expect(await service.needsYouCount(await member())).toEqual({ count: 2 });
      await service.offer(await studio(), { id: first.id });
      const { data } = await service.list(await member());
      expect(data.filter((w) => w.progress.needsYou)).toHaveLength(1);
      expect(await service.needsYouCount(await member())).toEqual({ count: 1 });
      await signAsBuilder(first.id);
      expect(await service.needsYouCount(await member())).toEqual({ count: 2 });
    });

    test("another account can't see or accept the work order", async () => {
      const created = await service.create(await studio(), fields());
      await service.offer(await studio(), { id: created.id });
      await refused(service.mineGet(stranger(), { id: created.id }), "NOT_FOUND");
      await refused(service.myDocument(stranger(), { id: created.id }), "NOT_FOUND");
      await refused(
        service.sign(stranger(), { id: created.id, documentSha256: "0".repeat(64), name: "M" }),
        "NOT_FOUND",
      );
    });

    test("changing the terms after acceptance sends it back to draft", async () => {
      const created = await service.create(await studio(), fields());
      await service.offer(await studio(), { id: created.id });
      await signAsBuilder(created.id);
      const edited = await service.update(await studio(), {
        id: created.id,
        budgetAmount: "2000000000",
      });
      expect(edited.status).toBe("draft");
      expect(edited.acceptedAt).toBeNull();
    });

    test("a builder without a GitHub login can't be offered the work order until it's added", async () => {
      const created = await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near" }),
      );
      expect(created.activationBlockers).toContain("Add the builder's GitHub login");
      await refused(service.offer(await studio(), { id: created.id }), "NO_GITHUB_LOGIN");
      const fixed = await service.setGithubLogin(await studio(), {
        id: created.id,
        githubLogin: "@NoGit-GH",
      });
      expect(fixed.builder.githubLogin).toBe("nogit-gh");
      await refused(
        service.setGithubLogin(await studio(), { id: created.id, githubLogin: "other" }),
        "GITHUB_LOGIN_SET",
      );
      await service.offer(await studio(), { id: created.id });
      await signAsBuilder(created.id, signedIn("nogit", null, "nogit.near"), "No Git");
      clock = new Date("2026-08-31T12:00:00.000Z");
      expect(
        (await service.countersign(await studio(), { id: created.id, name: "Rita Rep" })).status,
      ).toBe("active");
    });

    test("a GitHub login typed for a builder without one is remembered for the next work order", async () => {
      const first = await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near", githubLogin: "@NoGit-GH" }),
      );
      expect(first.builder.githubLogin).toBe("nogit-gh");
      expect(await rememberedLogin(db, "studio", "nogit.near")).toBe("nogit-gh");
      expect(await rememberedLogin(db, "rival", "nogit.near")).toBeNull();
      expect(builders.get("nogit.near")?.githubLogin).toBeNull();
      const second = await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near", code: "WO-0099" }),
      );
      expect(second.builder.githubLogin).toBe("nogit-gh");
    });

    test("a GitHub login set later is remembered too", async () => {
      const created = await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near" }),
      );
      expect(await rememberedLogin(db, "studio", "nogit.near")).toBeNull();
      await service.setGithubLogin(await studio(), { id: created.id, githubLogin: "nogit-gh" });
      expect(await rememberedLogin(db, "studio", "nogit.near")).toBe("nogit-gh");
      await service.update(await studio(), { id: created.id, githubLogin: "nogit-2" });
      expect(await rememberedLogin(db, "studio", "nogit.near")).toBe("nogit-2");
    });

    test("a builder whose profile has a GitHub login keeps it; a different one isn't remembered", async () => {
      const created = await service.create(await studio(), fields({ githubLogin: "carol-alt" }));
      expect(created.builder.githubLogin).toBe("carol-alt");
      expect(await rememberedLogin(db, "studio", CAROL)).toBeNull();
      expect(builders.get(CAROL)?.githubLogin).toBe("carol-gh");
      const next = await service.create(await studio(), fields({ code: "WO-0099" }));
      expect(next.builder.githubLogin).toBe("carol-gh");
    });

    test("only managers write; members read; other agencies see nothing", async () => {
      const created = await service.create(await studio(), fields());
      expect((await service.list(await member())).data.map((w) => w.id)).toEqual([created.id]);
      const rival = await world.manager("rival-admin", "rival");
      await refused(service.get(rival, { id: created.id }), "NOT_FOUND");
    });

    test("activity lists the emails sent for the work order, without their bodies", async () => {
      const created = await service.create(await studio(), fields());
      const other = await service.create(await studio(), fields({ code: "WO-0050" }));
      const email = (to: string, subject: string) =>
        JSON.stringify({ to, subject, text: "secret body", html: "<p>secret body</p>" });
      await db.insert(workOrderOutbox).values([
        {
          id: "e1",
          organizationId: "studio",
          workOrderId: created.id,
          eventType: "work_order.offered",
          payload: email("carol@example.com", "Sign WO-0001"),
          deliveredAt: new Date("2026-09-20T12:01:00.000Z"),
          createdAt: new Date("2026-09-20T12:00:00.000Z"),
        },
        {
          id: "e2",
          organizationId: "studio",
          workOrderId: created.id,
          eventType: "work_order.signed",
          payload: email("rita@example.com", "Carol signed WO-0001"),
          lastError: "Resend is down",
          createdAt: new Date("2026-09-21T12:00:00.000Z"),
        },
        {
          id: "e4",
          organizationId: "studio",
          workOrderId: other.id,
          eventType: "work_order.offered",
          payload: email("carol@example.com", "Sign WO-0050"),
          createdAt: new Date("2026-09-20T12:00:00.000Z"),
        },
        {
          id: "e5",
          organizationId: "studio",
          workOrderId: created.id,
          eventType: "work_order.active",
          payload: "not json",
          createdAt: new Date("2026-09-22T12:00:00.000Z"),
        },
      ]);

      const { emails } = await service.activity(await member(), { id: created.id });
      expect(emails).toEqual([
        {
          id: "e1",
          eventType: "work_order.offered",
          to: "carol@example.com",
          subject: "Sign WO-0001",
          createdAt: "2026-09-20T12:00:00.000Z",
          deliveredAt: "2026-09-20T12:01:00.000Z",
          lastError: null,
        },
        {
          id: "e2",
          eventType: "work_order.signed",
          to: "rita@example.com",
          subject: "Carol signed WO-0001",
          createdAt: "2026-09-21T12:00:00.000Z",
          deliveredAt: null,
          lastError: "Resend is down",
        },
        {
          id: "e5",
          eventType: "work_order.active",
          to: null,
          subject: null,
          createdAt: "2026-09-22T12:00:00.000Z",
          deliveredAt: null,
          lastError: null,
        },
      ]);
      expect(JSON.stringify(emails)).not.toContain("secret body");
      const rival = await world.manager("rival-admin", "rival");
      await refused(service.activity(rival, { id: created.id }), "NOT_FOUND");
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
    test("collecting again keeps the ids of evidence a submitted request froze", async () => {
      strongEvidence();
      const wo = await active();
      const first = await service.collect(await studio(), { id: wo.id });
      const again = await service.collect(await studio(), { id: wo.id });
      expect(again.evidence.map((e) => e.id).sort()).toEqual(
        first.evidence.map((e) => e.id).sort(),
      );
      expect(first.evidence.length).toBeGreaterThan(0);
    });

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

    test("a proposal that failed to execute keeps the request reserved until the chain settles it", async () => {
      const { wo, request } = await submitted();
      await service.approveRequest(await studio(), { requestId: request.id, amount: "600000000" });
      transfer(14);
      const treasury = requireTreasury(await studio());
      await service.linkProposal(treasury, { requestId: request.id, proposalId: "14" });
      transfer(14, { status: "Failed" });
      const stuck = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(stuck.status).toBe("proposed");
      expect((await service.get(await studio(), { id: wo.id })).remainingAmount).toBe("400000000");
      expect((await notificationsOf("carol")).map((n) => n.kind)).not.toContain(
        "compensation_request_failed",
      );
      await refused(service.payNow(await studio(), { requestId: request.id }), "NOT_APPROVED");
      transfer(15);
      await refused(
        service.linkProposal(treasury, { requestId: request.id, proposalId: "15" }),
        "NOT_APPROVED",
      );
      transfer(14, { status: "Approved" });
      const paid = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(paid.status).toBe("paid");
    });

    test("a proposal removed from the DAO frees the budget; a lookup that fails changes nothing", async () => {
      const { wo, request } = await submitted();
      await service.approveRequest(await studio(), { requestId: request.id, amount: "600000000" });
      transfer(16);
      const lookup = serviceDeps.proposal;
      serviceDeps.proposal = async () => {
        throw new Error("RPC unavailable");
      };
      await refused(
        service.linkProposal(requireTreasury(await studio()), {
          requestId: request.id,
          proposalId: "16",
        }),
        "PROPOSAL_UNAVAILABLE",
      );
      serviceDeps.proposal = lookup;
      await service.linkProposal(requireTreasury(await studio()), {
        requestId: request.id,
        proposalId: "16",
      });
      serviceDeps.proposal = async () => {
        throw new Error("RPC unavailable");
      };
      const unchanged = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(unchanged.status).toBe("proposed");
      serviceDeps.proposal = lookup;
      proposals.delete(`${DAO}#16`);
      const failed = await service.refreshPayment(await studio(), { requestId: request.id });
      expect(failed.status).toBe("failed");
      expect(failed.note).toMatch(/Proposal #16 ended as Removed; nothing was paid/);
      expect((await service.get(await studio(), { id: wo.id })).remainingAmount).toBe("1000000000");
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
      const preview = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: request.id,
      });
      const [untouched] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, request.id));
      expect(untouched?.daoPaymentStartedAt).toBeNull();
      expect(untouched?.note).toBeNull();
      const tx = await service.startDaoPayment(requireTreasury(await studio()), {
        requestId: request.id,
      });
      expect(tx).toEqual(preview);
      expect(tx.daoAccountId).toBe(DAO);
      expect(tx.deposit).toBe("100000000000000000000000");
      expect(tx.args.proposal.kind.Transfer).toEqual({
        token_id: USDC,
        receiver_id: CAROL,
        amount: "600000000",
        msg: null,
      });
      expect(tx.args.proposal.description).toMatch(
        new RegExp(
          `^\\* Title: ${request.code.split("-R")[0]}-R1: .+ <br>\\* Notes: Project: .+; Covers .+ to .+`,
        ),
      );
      const t = tx.args.proposal.kind.Transfer;
      transfer(13, { tokenId: t.token_id, receiverId: t.receiver_id, amount: t.amount });
      const linked = await service.linkProposal(requireTreasury(await studio()), {
        requestId: request.id,
        proposalId: "13",
      });
      expect(linked.status).toBe("proposed");
    });

    test("a request covering dates already approved or paid shows the overlap", async () => {
      const { wo, request } = await submitted();
      expect(request.overlaps).toEqual([]);
      await service.approveRequest(await studio(), { requestId: request.id, amount: "600000000" });
      const second = await service.mineDraftRequest(carol(), {
        id: wo.id,
        coversFrom: "2026-09-15",
        coversTo: "2026-09-30",
      });
      expect(second.overlaps).toEqual(["WO-0001-R1"]);
      const detail = await service.get(await studio(), { id: wo.id });
      expect(detail.requests.find((r) => r.id === second.id)?.overlaps).toEqual(["WO-0001-R1"]);
      expect(detail.requests.find((r) => r.id === request.id)?.overlaps).toEqual([]);
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
        status: "offered",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        renewedFrom: parent.id,
        acceptedAt: null,
        signature: { method: null },
      });
      expect(child.signing.builder).toBeNull();
      const [childRow] = await db.select().from(workOrders).where(eq(workOrders.id, child.id));
      expect(childRow?.projectTitle).toBe(parent.projectTitle);
      expect(
        (await service.get(await studio(), { id: parent.id })).requests.map((r) => r.status),
      ).toEqual(["draft"]);
      expect((await notificationsOf("carol")).map((n) => n.kind)).toEqual(
        expect.arrayContaining([
          "compensation_request_ready",
          "work_order_renewed",
          "work_order_offered",
        ]),
      );
      const renewed = events.find((e) => e.type === "work_order.renewed");
      expect(renewed?.workOrder.id).toBe("WO-0001-M2");
      expect(renewed?.workOrder.periodStart).toBe("2026-10-01");
      const agencyEmail = composeEmails({
        ...renewed!,
        representative: { name: "Rita Rep", email: "rita@example.com" },
      }).find((m) => m.to === "rita@example.com");
      expect(agencyEmail?.subject).toBe("Work Order WO-0001-M2 renews: Carol accepts it next");
      expect(agencyEmail?.text).toContain("countersign it and it becomes active");
      expect(agencyEmail?.text).not.toContain("Sign it first");

      await signAsBuilder(child.id);
      const signed = await service.countersign(await studio(), { id: child.id, name: "Rita Rep" });
      expect(signed).toMatchObject({ status: "active", periodStart: "2026-10-01" });
      expect(signed.signature.method).toBe("in_app");
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

    test("offering clears an earlier send error, with or without Documenso", async () => {
      const created = await service.create(await studio(), fields());
      await db
        .update(workOrders)
        .set({ esignError: "The renewal wasn't sent for signature: Drive was down" })
        .where(eq(workOrders.id, created.id));
      expect((await service.get(await studio(), { id: created.id })).signing.esign?.error).toMatch(
        /Drive was down/,
      );
      const offered = await service.offer(await studio(), { id: created.id });
      expect(offered.status).toBe("offered");
      expect(offered.signing.esign).toBeNull();
      expect(offered.progress.attention.map((a) => a.key)).not.toContain("esign");
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

    test("creating a draft sends the template terms, with both contacts", async () => {
      const created = await service.create(
        await studio(),
        fields({
          tokenId: REAL_USDC,
          representativeName: "Rita Rep",
          representativeEmail: "rita@studio.example",
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
        email: "rita@studio.example",
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

    test("agency emails go only to the representative's email on the work order", async () => {
      await service.create(await studio(), fields({ tokenId: REAL_USDC }));
      const event = events.find((e) => e.type === "work_order.created");
      expect(event?.representative.email).toBeNull();
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
  describe("Google Docs and Drive", () => {
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

    test("a work order whose project is gone is refused without blaming Google", async () => {
      const created = await service.create(await studio(), fields());
      await db
        .update(workOrders)
        .set({ projectId: "deleted-project", projectTitle: null })
        .where(eq(workOrders.id, created.id));
      const copies = google.copies.length;
      await refused(
        service.prepareDocument(await studio(), { id: created.id }),
        "PROJECT_UNAVAILABLE",
      );
      expect(google.copies).toHaveLength(copies);
      const [integration] = await db
        .select()
        .from(workOrderIntegrations)
        .where(eq(workOrderIntegrations.organizationId, "studio"));
      expect(integration?.googleLastError).toBeNull();
    });

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
      expect(events.map((e) => e.type)).toEqual([]);
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

    test("a new payee confirms with their wallet before a Drive-signed order starts", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      google.addPdf("signed", "pdf-1", signedLines("doc-1"));
      await service.checkDrive(await studio());
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.payee).toMatchObject({ paidBefore: false, needsConfirmation: true });
      expect(signed.activationBlockers.join(" ")).toMatch(/hasn't confirmed the payout account/);
      clock = new Date("2026-08-31T12:00:00.000Z");
      await refused(service.activate(await studio(), { id: created.id }), "ACTIVATION_BLOCKED");

      await refused(service.confirmPayee(stranger(), { id: created.id }), "NOT_FOUND");
      const confirmed = await service.confirmPayee(carol(), { id: created.id });
      expect(confirmed.payee.confirmedAt).not.toBeNull();
      expect(events.map((e) => e.type)).toContain("work_order.payee_confirmed");
      expect(confirmed.status).toBe("active");
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
      clock = new Date("2026-08-31T12:00:00.000Z");
      google.addPdf("signed", "pdf-1", signedLines("doc-1"));
      await service.checkDrive(await studio());
      expect(events.map((e) => e.type)).not.toContain("work_order.confirm_payee");
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.status).toBe("active");
      expect(signed.payee.needsConfirmation).toBe(false);
      expect(signed.activatedAt).toBe("2026-08-31T12:00:00.000Z");
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

    test("offer → the builder signs → the representative countersigns → signed PDF in Drive", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await service.offer(await studio(), { id: created.id });
      expect(google.exported.has("doc-1")).toBe(true);
      expect(events.map((e) => e.type)).toContain("work_order.offered");
      const offered = await service.myDocument(carol(), { id: created.id });
      expect(offered.kind).toBe("offered");
      expect(offered.current).toBe(true);

      await refused(
        service.countersign(await studio(), { id: created.id, name: "Rita Rep" }),
        "NOT_SIGNED_BY_BUILDER",
      );
      await signAsBuilder(created.id, carol(), "Carol Builder");
      const told = events.find((e) => e.type === "work_order.builder_signed");
      expect(told?.note).toBe("Carol Builder");
      expect(told?.links.review).toBe(`https://app.example/admin/work-orders/${created.id}`);

      const done = await service.countersign(
        await studio(),
        { id: created.id, name: "Rita Rep" },
        { ip: "198.51.100.2", userAgent: "Admin browser" },
      );
      expect(done.signature.method).toBe("in_app");
      expect(done.documentUrl).toBe("https://drive.google.com/file/d/upload-1/view");
      expect(google.uploads[0]).toMatchObject({
        folderId: "signed",
        name: "Work Order WO-0001 - Contributor role (signed).pdf",
      });
      await refused(
        service.countersign(await studio(), { id: created.id, name: "Rita Rep" }),
        "ALREADY_SIGNED",
      );

      const signed = await service.document(await studio(), { id: created.id });
      expect(signed.kind).toBe("signed");
      expect(signed.sha256).toBe(done.documentSha256);
      const text = await pdfText(fromBase64(signed.pdfBase64));
      for (const part of [
        "Signature certificate",
        offered.sha256,
        "Carol Builder",
        "carol.near",
        "203.0.113.7",
        "Rita Rep",
        "198.51.100.2",
        "WO-0001",
      ]) {
        expect(text).toContain(part);
      }
      expect(events.filter((e) => e.type === "work_order.signed").at(-1)?.links.document).toBe(
        "https://drive.google.com/file/d/upload-1/view",
      );
      expect((await service.checkDrive(await studio())).checked).toBe(0);
    });

    test("changing a term after the builder signed voids the signature", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, representativeName: "Rita Rep" }),
      );
      await service.offer(await studio(), { id: created.id });
      await signAsBuilder(created.id);
      const edited = await service.update(await studio(), {
        id: created.id,
        budgetAmount: "5000000",
      });
      expect(edited.status).toBe("draft");
      expect(edited.signing).toEqual({
        documentSha256: null,
        builder: null,
        representative: null,
        needsCountersign: false,
        awaitingRepresentative: false,
        esign: null,
      });
      expect(await service.myDocument(carol(), { id: created.id }).catch(() => null)).toBeNull();
      await service.offer(await studio(), { id: created.id });
      expect((await service.myDocument(carol(), { id: created.id })).current).toBe(true);
    });

    test("template tags fill from known fields, fixed text and values asked on the work order", async () => {
      google.setDoc(
        "tpl",
        "Contractor {{contractor_name}} aka {{builder}} in {{jurisdiction}} at {{address}}. {{mystery}}",
      );
      await db
        .update(workOrderIntegrations)
        .set({
          googleFieldMap: JSON.stringify({
            builder: { kind: "field", field: "contractor_name" },
            jurisdiction: { kind: "text", value: "Delaware" },
            address: { kind: "ask", label: "Builder address" },
          }),
        })
        .where(eq(workOrderIntegrations.organizationId, "studio"));
      const created = await service.create(
        await studio(),
        fields({ tokenId: REAL_USDC, customFields: { address: "1 Main St" } }),
      );
      expect(google.textOf("doc-1")).toBe(
        "Contractor Carol aka Carol in Delaware at 1 Main St. {{mystery}}",
      );
      expect(created.customFields).toEqual({ address: "1 Main St" });
      expect(created.signature.documentWarning).toBe("Template tag {{mystery}} wasn't filled");

      const blank = await service.create(await studio(), fields({ tokenId: REAL_USDC }));
      expect(blank.signature.documentWarning).toContain('"Builder address" was left blank');
    });

    test("an organization's own Google connection is used before the service account", async () => {
      const own = new FakeGoogle(["work_order_id"]);
      own.kind = "oauth";
      service = createWorkOrdersService({
        ...serviceDeps,
        googleFor: async (organizationId) => (organizationId === "studio" ? own : null),
      });
      await service.create(await studio(), fields({ tokenId: REAL_USDC }));
      expect(own.copies.map((c) => c.templateId)).toEqual(["tpl"]);
      expect(google.copies).toEqual([]);
    });

    test("the payout method describes a NEAR payment for both payout paths", () => {
      const values = documentFields({
        code: "WO-1",
        project: "P",
        contractorName: "C",
        contractorEmail: null,
        representativeName: "R",
        representativeEmail: null,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        budgetDecimal: "1",
        budget: "$1",
        ipModel: null,
        payee: "c.near",
        github: "",
        repos: [],
        autoRenew: false,
        scope: null,
      });
      expect(values.payout_method).toBe("Paid in NEAR to the account above");
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
  describe("signing without Google", () => {
    test("the work order PDF is generated from the terms", async () => {
      const created = await service.create(
        await studio(),
        fields({ representativeName: "Rita Rep", contractorEmail: "carol@example.com" }),
      );
      await service.offer(await studio(), { id: created.id });
      const doc = await service.myDocument(carol(), { id: created.id });
      expect(doc.fileName).toBe("Work Order WO-0001.pdf");
      const text = await pdfText(fromBase64(doc.pdfBase64));
      for (const part of [
        "Work Order WO-0001",
        "Project p1",
        "carol.near",
        "carol-gh",
        REPO,
        "Rita Rep",
      ]) {
        expect(text).toContain(part);
      }
      await signAsBuilder(created.id);
      const done = await service.countersign(await studio(), { id: created.id, name: "Rita Rep" });
      expect(done.documentUrl).toBeNull();
      expect((await service.document(await studio(), { id: created.id })).kind).toBe("signed");
    });
  });

  describe("e-signature through Documenso", () => {
    let documenso: FakeDocumenso;

    beforeEach(() => {
      documenso = new FakeDocumenso();
      service = createWorkOrdersService({ ...serviceDeps, esign: documenso });
    });

    async function offered() {
      const created = await service.create(
        await studio(),
        fields({ representativeName: "Rita Rep", representativeEmail: "rita@example.com" }),
      );
      await service.offer(await studio(), { id: created.id });
      return created;
    }

    test("offering sends the document to the representative first, then the builder, with a signatures page", async () => {
      const created = await offered();
      const doc = documenso.last();
      expect(doc.externalId).toBe(created.id);
      expect(doc.subject).toBe(`Please sign Work Order ${created.code}`);
      expect(doc.signers.map((s) => [s.role, s.email])).toEqual([
        ["representative", "rita@example.com"],
        ["contractor", "carol@example.com"],
      ]);
      const pages = (await PDFDocument.load(doc.pdf)).getPageCount();
      expect(doc.signers[0]?.signature.page).toBe(pages);
      expect(doc.signers[1]?.signature.y).toBeGreaterThan(doc.signers[0]?.signature.y ?? 100);
      const offeredDoc = await service.document(await studio(), { id: created.id });
      expect(offeredDoc.sha256).toBe(createHash("sha256").update(doc.pdf).digest("hex"));
      expect(events.map((e) => e.type)).not.toContain("work_order.offered");
      expect((await notificationsOf("carol")).map((n) => n.kind)).not.toContain(
        "work_order_offered",
      );

      const admin = await service.get(await studio(), { id: created.id });
      expect(admin.status).toBe("offered");
      expect(admin.signing.awaitingRepresentative).toBe(true);
      expect(admin.activationBlockers).toContain("Sign it in Documenso to send it to the builder");
      expect(admin.signing.esign).toMatchObject({
        sent: true,
        builderUrl: null,
        representativeUrl: "https://sign.example/envelope_1/representative",
      });
      expect((await service.mine(carol())).data).toEqual([]);
      const mine = await service.mineGet(carol(), { id: created.id });
      expect(mine.signing.esign).toMatchObject({ builderUrl: null, representativeUrl: null });
    });

    test("the representative's signature sends the builder the offer once, and the builder's signature completes it", async () => {
      const created = await offered();
      const toSign = await service.get(await studio(), { id: created.id });
      expect(toSign.progress).toMatchObject({
        stage: "agency_signs",
        waitingOn: "you",
        next: {
          kind: "link",
          label: "Sign as Rita Rep",
          href: "https://sign.example/envelope_1/representative",
        },
      });
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      const sent = await service.get(await studio(), { id: created.id });
      expect(sent.status).toBe("offered");
      expect(sent.signing.representative?.name).toBe("Rita Rep");
      expect(sent.signing.awaitingRepresentative).toBe(false);
      expect(sent.progress).toMatchObject({ stage: "builder_signs", waitingOn: "builder" });
      expect(sent.activationBlockers).toContain(
        "Waiting for the builder to accept the terms or sign the document",
      );
      await service.get(await studio(), { id: created.id });
      await service.syncPendingSignatures();
      const offers = events.filter((e) => e.type === "work_order.offered");
      expect(offers).toHaveLength(1);
      expect(offers[0]?.links.sign).toBe("https://sign.example/envelope_1/contractor");
      expect(
        (await notificationsOf("carol")).filter((n) => n.kind === "work_order_offered"),
      ).toHaveLength(1);
      expect((await service.mine(carol())).data.map((w) => w.id)).toEqual([created.id]);
      const mine = await service.mineGet(carol(), { id: created.id });
      expect(mine.signing.esign).toMatchObject({
        builderUrl: "https://sign.example/envelope_1/contractor",
        representativeUrl: null,
      });

      documenso.sign("contractor", "2026-09-20T14:00:00.000Z");
      await service.run();
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.status).toBe("active");
      expect(signed.progress.steps.slice(0, 3).map((step) => step.state)).toEqual([
        "done",
        "done",
        "done",
      ]);
      expect(signed.acceptedAt).toBe("2026-09-20T14:00:00.000Z");
      expect(signed.signature.method).toBe("documenso");
      expect(signed.signing.builder?.name).toBe("Carol");
      expect(signed.signing.representative?.name).toBe("Rita Rep");
      expect(signed.payee.confirmedAt).not.toBeNull();
      expect(signed.documentSha256).toBe(
        createHash("sha256").update("%PDF-1.7 signed envelope_1 %%EOF").digest("hex"),
      );
      expect(events.map((e) => e.type)).not.toContain("work_order.builder_signed");
      expect(events.filter((e) => e.type === "work_order.signed")).toHaveLength(1);
      expect(events.filter((e) => e.type === "work_order.offered")).toHaveLength(1);
      expect((await notificationsOf("carol")).map((n) => n.kind)).toContain("work_order_activated");
    });

    test("builder actions never return the representative's signing link", async () => {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      await service.get(await studio(), { id: created.id });
      const confirmed = await service.confirmPayee(carol(), { id: created.id });
      expect(confirmed.signing.esign).toMatchObject({
        builderUrl: "https://sign.example/envelope_1/contractor",
        representativeUrl: null,
      });
      const listed = await service.mine(carol());
      expect(listed.data[0]?.signing.esign?.representativeUrl).toBeNull();
      const updated = await service.update(await studio(), { id: created.id, title: "Renamed" });
      expect(updated.signing.esign?.builderUrl ?? null).toBeNull();
    });

    test("an edit waits while the signatures are being checked", async () => {
      const created = await offered();
      let during: Promise<unknown> = Promise.resolve();
      documenso.onStatus = async () => {
        during = service.update(await studio(), { id: created.id, title: "Renamed" });
        await during.catch(() => undefined);
      };
      await service.get(await studio(), { id: created.id });
      await refused(during, "SIGNATURES_BUSY");
      const updated = await service.update(await studio(), { id: created.id, title: "Renamed" });
      expect(updated.title).toBe("Renamed");
    });

    test("declining, changing the terms or deleting cancels the Documenso envelope", async () => {
      const first = await offered();
      await service.decline(carol(), { id: first.id, note: "Not now" });
      expect(documenso.cancelled).toEqual([
        { envelopeId: "envelope_1", reason: "The builder declined" },
      ]);

      await service.offer(await studio(), { id: first.id });
      await service.update(await studio(), { id: first.id, budgetAmount: "2000000000" });
      expect(documenso.cancelled.at(-1)).toEqual({
        envelopeId: "envelope_2",
        reason: "The terms changed; a new version will be sent",
      });

      await service.offer(await studio(), { id: first.id });
      await service.remove(await studio(), { id: first.id });
      expect(documenso.cancelled.at(-1)?.envelopeId).toBe("envelope_3");
    });

    test("an offered work order the builder already signed in Documenso can't be deleted", async () => {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      documenso.sign("contractor", "2026-09-20T14:00:00.000Z");
      await refused(service.remove(await studio(), { id: created.id }), "ALREADY_SIGNED");
      expect(documenso.cancelled).toEqual([]);
      expect((await service.get(await studio(), { id: created.id })).status).not.toBe("offered");
    });

    test("deleting stops when Documenso can't be checked or the envelope can't be cancelled", async () => {
      const created = await offered();
      const status = documenso.status.bind(documenso);
      documenso.status = async () => {
        throw new Error("Documenso is down");
      };
      await refused(service.remove(await studio(), { id: created.id }), "ESIGN_UNCHECKED");
      documenso.status = status;
      const cancel = documenso.cancel.bind(documenso);
      documenso.cancel = async () => {
        throw new Error("timeout");
      };
      await refused(service.remove(await studio(), { id: created.id }), "ESIGN_CANCEL_FAILED");
      documenso.cancel = cancel;
      expect((await service.get(await studio(), { id: created.id })).status).toBe("offered");
      await service.remove(await studio(), { id: created.id });
    });

    test("deleting after the representative signed doesn't send the builder the offer", async () => {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      await service.remove(await studio(), { id: created.id });
      expect(events.map((e) => e.type)).not.toContain("work_order.offered");
      expect((await notificationsOf("carol")).map((n) => n.kind)).not.toContain(
        "work_order_offered",
      );
      expect(documenso.cancelled.at(-1)?.reason).toBe("The work order was withdrawn");
    });

    test("deleting a work order the builder declined in Documenso tells no one", async () => {
      const created = await offered();
      documenso.reject("contractor");
      await service.remove(await studio(), { id: created.id });
      expect((await notificationsOf("studio-admin")).map((n) => n.kind)).not.toContain(
        "work_order_declined",
      );
      expect(documenso.cancelled).toEqual([]);
    });

    test("terminating goes through when Documenso can't withdraw the envelope, and says so", async () => {
      const created = await offered();
      documenso.status = async () => {
        throw new Error("Documenso is down");
      };
      documenso.cancel = async () => {
        throw new Error("timeout");
      };
      const terminated = await service.terminate(await studio(), { id: created.id });
      expect(terminated.status).toBe("terminated");
      expect(terminated.signing.esign?.error).toBe(
        "Couldn't withdraw it in Documenso, so the builder may still be able to sign there: timeout",
      );
      expect(terminated.progress.attention.map((a) => a.key)).toContain("esign");
    });

    test("terminating doesn't warn about an envelope that was already rejected in Documenso", async () => {
      const created = await offered();
      documenso.reject("contractor");
      const terminated = await service.terminate(await studio(), { id: created.id });
      expect(terminated.status).toBe("terminated");
      expect(terminated.signing.esign?.error ?? null).toBeNull();
      expect(documenso.cancelled).toEqual([]);
    });

    test("terminating withdraws the envelope without recording signatures first", async () => {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      const terminated = await service.terminate(await studio(), { id: created.id });
      expect(terminated.status).toBe("terminated");
      expect(terminated.signing.esign?.error ?? null).toBeNull();
      expect(documenso.cancelled.at(-1)?.reason).toBe("The work order was terminated");
      expect(events.map((e) => e.type)).not.toContain("work_order.offered");
    });

    async function completed() {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      await service.syncPendingSignatures();
      documenso.sign("contractor", "2026-09-20T14:00:00.000Z");
      await service.syncPendingSignatures();
      return service.get(await studio(), { id: created.id });
    }

    const driveFolders = (signedFolderId: string | null) =>
      createWorkOrderIntegrations({ db }).saveGoogle("studio", "studio-admin", {
        templateId: null,
        documentsFolderId: "docs",
        signedFolderId,
      });

    test("the signed PDF is saved to the Signed folder once, and the folder check skips it", async () => {
      await driveFolders("signed");
      const signed = await completed();
      expect(signed.status).toBe("active");
      expect(google.uploads.map((u) => [u.folderId, u.name])).toEqual([
        ["signed", "Work Order WO-0001 - Contributor role (signed).pdf"],
      ]);
      expect(signed.signature.driveUrl).toBe("https://drive.google.com/file/d/upload-1/view");
      expect(signed.signature.driveError).toBeNull();
      await service.tick("t1");
      clock = new Date(clock.getTime() + 3_600_000);
      await service.tick("t2");
      expect(google.uploads).toHaveLength(1);
      await db.delete(workOrderDriveFiles);
      expect((await service.checkDrive(await studio())).checked).toBe(0);
    });

    test("a failed upload doesn't block signing and is retried on a later tick", async () => {
      await driveFolders(null);
      google.failUploads = 1;
      const signed = await completed();
      expect(signed.status).toBe("active");
      expect(signed.signature.driveError).toMatch(/Drive upload failed/);
      expect(google.uploads).toHaveLength(0);
      await service.tick("t1");
      expect(google.uploads).toHaveLength(0);
      clock = new Date(clock.getTime() + 6 * 60_000);
      const tick = await service.tick("t2");
      expect(tick.counts.driveUploads).toBe(1);
      expect(google.uploads.map((u) => u.folderId)).toEqual(["docs"]);
      const saved = await service.get(await studio(), { id: signed.id });
      expect(saved.signature.driveUrl).toBe("https://drive.google.com/file/d/upload-1/view");
      expect(saved.signature.driveError).toBeNull();
    });

    test("without a Google connection the signed PDF stays in MultiAgency only", async () => {
      await driveFolders("signed");
      service = createWorkOrdersService({ ...serviceDeps, google: null, esign: documenso });
      const signed = await completed();
      expect(signed.status).toBe("active");
      expect(signed.signature.driveUrl).toBeNull();
      expect(signed.signature.driveError).toBeNull();
      expect(google.uploads).toHaveLength(0);
    });

    test("a signed PDF already filed in Drive isn't uploaded again, and rows that never failed aren't retried", async () => {
      await driveFolders("signed");
      const live = service;
      service = createWorkOrdersService({ ...serviceDeps, google: null, esign: documenso });
      const filed = await completed();
      expect(google.uploads).toHaveLength(0);
      await db
        .update(workOrderDocuments)
        .set({ driveFileId: "legacy-1", driveUrl: "https://drive.google.com/file/d/legacy-1/view" })
        .where(
          and(eq(workOrderDocuments.workOrderId, filed.id), eq(workOrderDocuments.kind, "signed")),
        );
      service = live;
      clock = new Date(clock.getTime() + 3_600_000);
      await service.tick("t1");
      expect(google.uploads).toHaveLength(0);
      const saved = await service.saveSignedToDrive(await studio(), { id: filed.id });
      expect(saved.signature.driveUrl).toBe("https://drive.google.com/file/d/legacy-1/view");
      expect(google.uploads).toHaveLength(0);
    });

    test("a renewal goes out for signature with the new dates, and its signed PDF is filed in Drive", async () => {
      await driveFolders("signed");
      const created = await service.create(
        await studio(),
        fields({
          autoRenew: true,
          representativeName: "Rita Rep",
          representativeEmail: "rita@example.com",
        }),
      );
      await service.offer(await studio(), { id: created.id });
      documenso.sign("representative", "2026-09-01T09:00:00.000Z");
      await service.syncPendingSignatures();
      documenso.sign("contractor", "2026-09-01T10:00:00.000Z");
      await service.syncPendingSignatures();
      expect((await service.get(await studio(), { id: created.id })).status).toBe("active");
      expect(google.uploads).toHaveLength(1);

      clock = new Date("2026-10-03T06:00:00.000Z");
      await service.run();
      await service.decideRenewal(await studio(), { id: created.id, decision: "approve" });
      const child = (await service.list(await studio())).data.find((w) => w.code === "WO-0001-M2")!;
      expect(child).toMatchObject({ status: "offered", periodStart: "2026-10-01" });
      expect(child.signing.awaitingRepresentative).toBe(true);
      expect(documenso.sent).toHaveLength(2);
      expect(documenso.last().externalId).toBe(child.id);
      const renewed = events.find((e) => e.type === "work_order.renewed");
      expect(renewed?.links.countersign).toBe("https://sign.example/envelope_2/representative");
      const email = composeEmails(renewed!).find((m) => m.to === "rita@example.com");
      expect(email?.subject).toBe("Sign the renewal: Work Order WO-0001-M2");
      expect(email?.html).toContain("https://sign.example/envelope_2/representative");

      documenso.sign("representative", "2026-10-03T07:00:00.000Z");
      await service.syncPendingSignatures();
      expect(
        events.filter((e) => e.type === "work_order.offered").map((e) => e.workOrder.id),
      ).toContain("WO-0001-M2");
      documenso.sign("contractor", "2026-10-03T08:00:00.000Z");
      await service.syncPendingSignatures();
      const active = await service.get(await studio(), { id: child.id });
      expect(active).toMatchObject({ status: "active", periodStart: "2026-10-01" });
      expect(active.signature.method).toBe("documenso");
      expect(google.uploads.map((u) => u.name)).toEqual([
        "Work Order WO-0001 - Contributor role (signed).pdf",
        "Work Order WO-0001-M2 - Contributor role (signed).pdf",
      ]);
    });

    test("a renewal that can't be sent stays a draft and tells the agency why", async () => {
      const created = await service.create(
        await studio(),
        fields({
          autoRenew: true,
          representativeName: "Rita Rep",
          representativeEmail: "rita@example.com",
        }),
      );
      await service.offer(await studio(), { id: created.id });
      documenso.sign("representative", "2026-09-01T09:00:00.000Z");
      documenso.sign("contractor", "2026-09-01T10:00:00.000Z");
      await service.syncPendingSignatures();
      clock = new Date("2026-10-03T06:00:00.000Z");
      await service.run();
      documenso.send = async () => {
        throw new Error("Documenso is down");
      };
      await service.decideRenewal(await studio(), { id: created.id, decision: "approve" });
      const child = (await service.list(await studio())).data.find((w) => w.code === "WO-0001-M2")!;
      expect(child.status).toBe("draft");
      expect(child.signing.esign?.error ?? null).toMatch(
        /wasn't sent for signature: .*Documenso is down/,
      );
      const renewed = events.find((e) => e.type === "work_order.renewed");
      const email = composeEmails(renewed!).find((m) => m.to === "rita@example.com");
      expect(email?.text).toContain("saved as a draft");
      expect(email?.subject).toBe("The renewal WO-0001-M2 wasn't sent: it needs you");
      expect(email?.text).not.toContain("Review and sign");
    });

    test("builders never get the agency's signing link or actions, and can't sign around Documenso", async () => {
      const created = await offered();
      documenso.sign("representative", "2026-09-20T12:30:00.000Z");
      await service.get(await studio(), { id: created.id });

      const second = await service.create(
        await studio(),
        fields({
          code: "WO-0002",
          representativeName: "Rita Rep",
          representativeEmail: "rita@example.com",
        }),
      );
      await service.offer(await studio(), { id: second.id });
      expect((await service.get(await studio(), { id: second.id })).progress.next).toMatchObject({
        href: "https://sign.example/envelope_2/representative",
      });
      for (const view of [
        await service.mineGet(carol(), { id: second.id }),
        await service.mineGet(carol(), { id: created.id }),
        ...(await service.mine(carol())).data,
      ]) {
        expect(JSON.stringify(view)).not.toMatch(/envelope_\d\/representative/);
        expect(view.progress.next).toBeNull();
        expect(view.progress.attention).toEqual([]);
      }

      for (const id of [second.id, created.id]) {
        const doc = await service.myDocument(carol(), { id });
        await refused(
          service.sign(carol(), { id, documentSha256: doc.sha256, name: "Carol" }),
          "SIGN_IN_DOCUMENSO",
        );
      }
      expect((await service.get(await studio(), { id: second.id })).status).toBe("offered");
    });

    test("an envelope sent before the agency signed first keeps the builder-first flow", async () => {
      const created = await offered();
      await db
        .update(workOrders)
        .set({ esignRepresentativeFirst: false })
        .where(eq(workOrders.id, created.id));
      documenso.builderFirst = true;

      const before = await service.get(await studio(), { id: created.id });
      expect(before.signing.awaitingRepresentative).toBe(false);
      expect(before.progress.waitingOn).toBe("builder");
      expect((await service.mine(carol())).data.map((w) => w.id)).toEqual([created.id]);
      const mine = await service.mineGet(carol(), { id: created.id });
      expect(mine.signing.esign?.builderUrl).toBe("https://sign.example/envelope_1/contractor");

      documenso.sign("contractor", "2026-09-20T13:00:00.000Z");
      const accepted = await service.get(await studio(), { id: created.id });
      expect(accepted.status).toBe("accepted");
      expect(accepted.signing.builder?.name).toBe("Carol");
      expect(accepted.signing.representative).toBeNull();
      expect(accepted.signing.needsCountersign).toBe(true);
      expect(accepted.progress).toMatchObject({ stage: "agency_signs", waitingOn: "you" });
      expect(events.filter((e) => e.type === "work_order.offered")).toHaveLength(0);

      documenso.sign("representative", "2026-09-20T14:00:00.000Z");
      await service.run();
      const signed = await service.get(await studio(), { id: created.id });
      expect(signed.status).toBe("active");
      expect(signed.signing.representative?.name).toBe("Rita Rep");
    });

    test("the background check picks up both signatures without anyone opening the page", async () => {
      const created = await offered();
      expect(await service.syncPendingSignatures()).toBe(1);
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      await service.syncPendingSignatures();
      expect(events.filter((e) => e.type === "work_order.offered")).toHaveLength(1);
      documenso.sign("contractor", "2026-09-20T14:00:00.000Z");
      await service.syncPendingSignatures();
      const [row] = await db.select().from(workOrders).where(eq(workOrders.id, created.id));
      expect(row?.status).toBe("active");
      expect(row?.signatureMethod).toBe("documenso");
      expect(row?.acceptedTermsHash).not.toBeNull();
      expect(await service.syncPendingSignatures()).toBe(0);
    });

    test("declining in Documenso puts the work order back to draft with the reason", async () => {
      const created = await offered();
      documenso.reject("representative");
      const back = await service.get(await studio(), { id: created.id });
      expect(back.status).toBe("draft");
      expect(back.signing.esign?.error).toBe("Declined in Documenso: Wrong budget");
      expect(events.map((e) => e.type)).not.toContain("work_order.offered");

      await service.offer(await studio(), { id: created.id });
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      await service.syncPendingSignatures();
      documenso.reject("contractor");
      const declined = await service.get(await studio(), { id: created.id });
      expect(declined.status).toBe("draft");
      expect(declined.signing.esign?.error).toBe("Declined in Documenso: Wrong budget");
    });

    test("it isn't offered without both emails, or when Documenso refuses", async () => {
      const created = await service.create(await studio(), fields());
      serviceDeps.userEmail = async () => null;
      service = createWorkOrdersService({ ...serviceDeps, esign: documenso });
      await expect(service.offer(await studio(), { id: created.id })).rejects.toThrow(
        /builder's and the representative's email/,
      );
      const withEmails = await service.create(
        await studio(),
        fields({ contractorEmail: "carol@example.com", representativeEmail: "rita@example.com" }),
      );
      documenso.failSend = "Documenso POST /envelope/create answered 401";
      await expect(service.offer(await studio(), { id: withEmails.id })).rejects.toThrow(
        /answered 401/,
      );
      expect((await service.get(await studio(), { id: withEmails.id })).status).toBe("draft");
    });
  });

  describe("USD budgets paid in a token at the live price", () => {
    const usdFields = { tokenId: "usd", payoutTokenId: "near", budgetAmount: "1000000000" };

    test("the conversion floors to the token's smallest unit", () => {
      expect(usdToTokens(600_000_000n, "4.99", 24).toString()).toBe("120240480961923847695390781");
      expect(usdToTokens(10_000n, "0.999675", 6).toString()).toBe("10003");
    });

    test("a USD budget is always paid in NEAR", async () => {
      const created = await service.create(
        await studio(),
        fields({ tokenId: "usd", payoutTokenId: USDC, budgetAmount: "1000000000" }),
      );
      expect(created.tokenId).toBe("usd");
      expect(created.payoutTokenId).toBe("near");
      expect(created.budgetAmount).toBe("1000000000");
    });

    test("$600 approved is quoted in NEAR at payment time and the proposal must pay the quote", async () => {
      strongEvidence();
      const wo = await active(usdFields);
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      await service.editRequest(carol(), { requestId: draft.id, requestedAmount: "600000000" });
      await service.submitRequest(carol(), { requestId: draft.id });
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      expect(events.find((e) => e.type === "request.approved")?.request?.approved).toBe("$600");

      const preview = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      expect(preview.quote).toMatchObject({
        usd: "600000000",
        tokenId: "near",
        amount: "120240480961923847695390781",
        priceUsd: "4.99",
      });
      expect(preview.args.proposal.kind.Transfer).toMatchObject({
        token_id: "",
        amount: "120240480961923847695390781",
      });
      expect(preview.args.proposal.description).toContain("$600 at 4.99 USD per NEAR");

      priceUsd = "5";
      const requote = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      expect(requote.quote.amount).toBe("120000000000000000000000000");
      transfer(20, { tokenId: "", amount: "120000000000000000000000000" });
      await refused(
        service.linkProposal(requireTreasury(await studio()), {
          requestId: draft.id,
          proposalId: "20",
        }),
        "NO_QUOTE",
      );
      const started = await service.startDaoPayment(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      expect(started.quote.amount).toBe("120000000000000000000000000");
      priceUsd = "6";
      const locked = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      expect(locked).toEqual(started);
      expect(
        await service.startDaoPayment(requireTreasury(await studio()), { requestId: draft.id }),
      ).toEqual(started);
      transfer(21, { tokenId: "", amount: "120240480961923847695390781" });
      await refused(
        service.linkProposal(requireTreasury(await studio()), {
          requestId: draft.id,
          proposalId: "21",
        }),
        "WRONG_AMOUNT",
      );
      transfer(22, { tokenId: "", amount: "120000000000000000000000000" });
      const linked = await service.linkProposal(requireTreasury(await studio()), {
        requestId: draft.id,
        proposalId: "22",
      });
      expect(linked.status).toBe("proposed");
      expect(linked.payout).toMatchObject({ tokenId: "near", priceUsd: "5" });
      const [billing] = await db.select().from(billings).where(eq(billings.proposalId, "22"));
      expect(billing).toMatchObject({ tokenId: "near", amount: "120000000000000000000000000" });
      const detail = await service.get(await studio(), { id: wo.id });
      expect(detail.committedAmount).toBe("600000000");
      expect(detail.remainingAmount).toBe("400000000");
    });
  });
  describe("automatic payouts through the NEAR Intents agent", () => {
    const usdFields = { tokenId: "usd", budgetAmount: "1000000000" };
    let agent: FakeAgentApi;
    let payouts: PayoutAgents;

    beforeEach(() => {
      agent = new FakeAgentApi();
      payouts = createPayoutAgents({
        db,
        api: agent,
        secretKey: "test-secret",
        payees: workOrderPayees(db),
        now: () => clock,
      });
      service = createWorkOrdersService({ ...serviceDeps, payouts });
    });

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

    async function approvedRequest() {
      strongEvidence();
      const wo = await active(usdFields);
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      await service.editRequest(carol(), { requestId: draft.id, requestedAmount: "600000000" });
      await service.submitRequest(carol(), { requestId: draft.id });
      return { wo, draft };
    }

    test("the agent's rules allow only active builders, pay automatically and cap each payout", async () => {
      const { wo } = await approvedRequest();
      await setUpAgent();
      expect(agent.policy).toMatchObject({
        owner_approval: false,
        assets: ["nep141:wrap.near"],
        actions: ["withdraw"],
        budget: { monthly_usd: "5000" },
        limits: { per_transaction: { "nep141:wrap.near": `500${"0".repeat(24)}` } },
        destinations: {
          mode: "only",
          list: [{ action: "withdraw", chain: "near", address: CAROL, memo: null }],
        },
      });
      const view = await payouts.view("studio");
      expect(view).toMatchObject({
        ready: true,
        blockers: [],
        grantValid: true,
        agentId: "agent-1",
      });
      expect(view.policy?.payees).toEqual([CAROL]);
      expect(view.balance).toEqual({ near: "0", usd: "0.00" });
      agent.balanceRaw = `12345${"0".repeat(20)}`;
      expect((await payouts.view("studio")).balance).toEqual({ near: "1.2345", usd: "2.47" });
      expect(wo.status).toBe("active");
    });

    test("the top-up covers the unpaid budget of active work orders, less the agent's balance", async () => {
      const { wo, draft } = await approvedRequest();
      await setUpAgent();
      const before = await service.fundingNeeds(await studio());
      expect(before.items).toEqual([
        expect.objectContaining({ code: wo.code, unpaid: "$1,000", builderNearAccount: CAROL }),
      ]);
      expect(before.near).toBe(usdToTokens(1_000_000_000n, "4.99", 24));
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      const after = await service.fundingNeeds(await studio());
      expect(after.items[0]?.unpaid).toBe("$400");
      expect(after.near).toBe(usdToTokens(400_000_000n, "4.99", 24));
      const near = 10n ** 24n;
      expect(topUpFor(80n * near, 0n)).toBe(80n * near);
      expect(topUpFor(80n * near + 1n, 0n)).toBe(8001n * 10n ** 22n);
      expect(topUpFor(80n * near, 100n * near)).toBe(0n);
    });

    test("approving pays the builder in NEAR right away and records the billing", async () => {
      const { wo, draft } = await approvedRequest();
      await setUpAgent();
      const paid = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(paid.status).toBe("paid");
      expect(agent.withdrawals).toEqual([
        {
          grant: expect.any(String),
          key: `multiagency:${draft.id}:a1`,
          body: {
            asset: "nep141:wrap.near",
            amount: "120240480961923847695390781",
            chain: "near",
            recipient: CAROL,
          },
        },
      ]);
      expect(paid.agentPayout).toMatchObject({
        status: "paid",
        txUrl: "https://nearblocks.io/txns/TXHASH1",
      });
      const [billing] = await db
        .select()
        .from(billings)
        .where(eq(billings.proposalId, "intents:TXHASH1"));
      expect(billing).toMatchObject({
        tokenId: "near",
        amount: "120240480961923847695390781",
        nearAccount: CAROL,
      });
      expect((await enrichWithChainStatus(db, billing!, DAO)).status).toBe("Approved");
      const released = events.find((e) => e.type === "request.payout_released");
      expect(released?.payout).toEqual({
        near: CAROL,
        txUrl: "https://nearblocks.io/txns/TXHASH1",
        accountUrl: `https://nearblocks.io/address/${CAROL}`,
      });
      expect((await service.get(await studio(), { id: wo.id })).paidAmount).toBe("600000000");
    });

    test("a payout still processing is followed up by the scheduled run", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      const paying = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(paying.status).toBe("paying");
      agent.statuses.set("pay-1", { status: "SUCCESS", details: { intent_hash: "IH1" } });
      await service.run("job");
      const detail = await service.get(await studio(), { id: paying.workOrderId });
      const request = detail.requests.find((r) => r.id === draft.id);
      expect(request?.status).toBe("paid");
      expect(request?.agentPayout?.txUrl).toBeNull();
      expect(request?.agentPayout?.accountUrl).toBe(`https://nearblocks.io/address/${CAROL}`);
      const released = events.find((e) => e.type === "request.payout_released");
      const email = composeEmails(released!).find((m) => m.subject.startsWith("Payout sent"));
      expect(email?.html).toContain(`https://nearblocks.io/address/${CAROL}`);
      expect(email?.html).not.toContain("explorer.near-intents.org");
      expect(email?.text).toContain("See it on NearBlocks");
    });

    test("a request can't be rejected while its payout is going out", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      agent.onWithdraw = async () => {
        agent.onWithdraw = null;
        await refused(
          service.rejectRequest(await studio(), { requestId: draft.id, note: "Too late" }),
          "NOT_SUBMITTED",
        );
      };
      const paying = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(paying.status).toBe("paying");
      await refused(
        service.rejectRequest(await studio(), { requestId: draft.id, note: "Still too late" }),
        "NOT_SUBMITTED",
      );
      agent.statuses.set("pay-1", { status: "SUCCESS", details: { tx_hash: "TX9" } });
      await service.run("job");
      const detail = await service.get(await studio(), { id: paying.workOrderId });
      expect(detail.requests.find((r) => r.id === draft.id)?.status).toBe("paid");
    });

    test("a refused payout leaves the request approved, and Pay now retries with a new key", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      const kept = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(kept.status).toBe("approved");
      expect(kept.note).toMatch(/didn't go out: insufficient_balance/);
      agent.nextWithdraw = { status: "SUCCESS", details: { tx_hash: "TX2" } };
      const paid = await service.payNow(await studio(), { requestId: draft.id });
      expect(paid.status).toBe("paid");
      expect(agent.withdrawals.map((w) => w.key)).toEqual([
        `multiagency:${draft.id}:a1`,
        `multiagency:${draft.id}:a2`,
      ]);
    });

    test("a builder the signed rules don't allow yet stays on the DAO path until you sign the update", async () => {
      await setUpAgent();
      const { draft } = await approvedRequest();
      const approved = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(approved.status).toBe("approved");
      expect(agent.withdrawals).toEqual([]);
      expect((await payouts.view("studio")).changes).toEqual([`allow paying ${CAROL}`]);
      await refused(service.payNow(await studio(), { requestId: draft.id }), "PAYOUTS_NOT_READY");
      const sync = await payouts.prepare("studio", { action: "sync_policy" });
      await payouts.submit("studio", {
        correlationId: sync.correlationId,
        signedData: await agent.sign(sync.intent),
      });
      expect((await payouts.view("studio")).changes).toEqual([]);
      expect((await service.payNow(await studio(), { requestId: draft.id })).status).toBe("paid");
    });

    test("an approved request of a terminated work order can't be paid any more", async () => {
      const { wo, draft } = await approvedRequest();
      const approved = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(approved.status).toBe("approved");
      await service.terminate(await studio(), { id: wo.id });
      await setUpAgent();
      await refused(service.payNow(await studio(), { requestId: draft.id }), "CLOSED");
      await refused(
        service.startDaoPayment(requireTreasury(await studio()), { requestId: draft.id }),
        "CLOSED",
      );
      await refused(
        service.paymentProposal(requireTreasury(await studio()), { requestId: draft.id }),
        "CLOSED",
      );
      expect(agent.withdrawals).toEqual([]);
    });

    test("a DAO payment started before termination can still be quoted and linked, not re-proposed", async () => {
      const { wo, draft } = await approvedRequest();
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      const started = await service.startDaoPayment(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      await service.terminate(await studio(), { id: wo.id });
      const quote = await service.paymentProposal(requireTreasury(await studio()), {
        requestId: draft.id,
      });
      expect(quote.quote).toEqual(started.quote);
      await refused(
        service.startDaoPayment(requireTreasury(await studio()), { requestId: draft.id }),
        "CLOSED",
      );
    });

    test("a payout that ends failed goes back to approved and the managers are told", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      const paying = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(paying.status).toBe("paying");
      agent.statuses.set("pay-1", { status: "FAILED", details: {} });
      const tick = await service.tick("t1");
      expect(tick.ran).toBe(true);
      const detail = await service.get(await studio(), { id: paying.workOrderId });
      const request = detail.requests.find((r) => r.id === draft.id);
      expect(request?.status).toBe("approved");
      expect(request?.note).toMatch(/needs a person to check it/);
      expect(request?.autoPayBlocked).toBeNull();
      expect((await notificationsOf("studio-admin")).map((n) => n.kind)).toContain(
        "compensation_request_payout_failed",
      );
      clock = new Date(clock.getTime() + 10 * 60_000);
      await service.tick("t2");
      expect(agent.withdrawals).toHaveLength(1);
    });

    test("a payout that needs review can still be rejected, and Pay now leaves it alone", async () => {
      const { wo, draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      agent.statuses.set("pay-1", { status: "NEEDS_REVIEW", details: {} });
      await service.tick("t1");
      const failedNotices = async () =>
        (await notificationsOf("studio-admin")).filter(
          (n) => n.kind === "compensation_request_payout_failed",
        ).length;
      expect(await failedNotices()).toBe(1);
      const view = await service.get(await studio(), { id: wo.id });
      expect(view.requests.find((r) => r.id === draft.id)?.agentPayout).toMatchObject({
        status: "needs_review",
        canRetry: false,
      });
      if (agent.policy) agent.policy = { ...agent.policy, frozen: true };
      await refused(service.payNow(await studio(), { requestId: draft.id }), "PAYOUTS_NOT_READY");
      const [kept] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(kept?.status).toBe("approved");
      expect(kept?.note).toMatch(/needs a person to check it/);
      expect(kept?.autoPayBlockedAt).toBeNull();
      clock = new Date(clock.getTime() + 10 * 60_000);
      await service.tick("t2");
      expect(await failedNotices()).toBe(1);
      expect(agent.withdrawals).toHaveLength(1);
      const rejected = await service.rejectRequest(await studio(), {
        requestId: draft.id,
        note: "Checked the agent's history: nothing went out",
      });
      expect(rejected.status).toBe("rejected");
    });

    test("the follow-up doesn't mistake an earlier refused attempt for the one being sent", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      const kept = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(kept.status).toBe("approved");
      clock = new Date(clock.getTime() + 60_000);
      await db
        .update(compensationRequests)
        .set({ status: "paying", autoPayTriedAt: clock, updatedAt: clock })
        .where(eq(compensationRequests.id, draft.id));
      await service.tick("t1");
      const [during] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(during?.status).toBe("paying");
      clock = new Date(clock.getTime() + 11 * 60_000);
      await service.tick("t2");
      const [after] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(after?.status).toBe("approved");
      expect(after?.note).toMatch(/interrupted before it reached the payout agent/);
    });

    test("a payout interrupted before it reached the agent is retried and paid", async () => {
      const { draft } = await approvedRequest();
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      await setUpAgent();
      await db
        .update(compensationRequests)
        .set({ status: "paying", updatedAt: clock })
        .where(eq(compensationRequests.id, draft.id));
      await service.run("job-1");
      const [early] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(early?.status).toBe("paying");
      clock = new Date(clock.getTime() + 11 * 60_000);
      await service.run("job-2");
      const [blocked] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(blocked?.status).toBe("approved");
      expect(blocked?.note).toMatch(/interrupted before it reached the payout agent/);
      expect((await notificationsOf("studio-admin")).map((n) => n.kind)).toContain(
        "compensation_request_payout_blocked",
      );
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.run("job-3");
      const [paid] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(paid?.status).toBe("paid");
      expect(agent.withdrawals).toHaveLength(1);
    });

    test("a payout that failed without proof nothing went out blocks the DAO path", async () => {
      const { wo, draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      agent.statuses.set("pay-1", { status: "FAILED", details: {} });
      await service.tick("t1");
      const detail = await service.get(await studio(), { id: wo.id });
      const request = detail.requests.find((r) => r.id === draft.id);
      expect(request?.status).toBe("approved");
      expect(request?.agentPayout).toMatchObject({ status: "failed", canRetry: false });
      expect(request?.note).not.toMatch(/DAO proposal/);
      const treasury = requireTreasury(await studio());
      await refused(
        service.linkProposal(treasury, { requestId: draft.id, proposalId: "7" }),
        "AGENT_PAYOUT_UNSETTLED",
      );
      await refused(
        service.paymentProposal(treasury, { requestId: draft.id }),
        "AGENT_PAYOUT_UNSETTLED",
      );
      await refused(
        service.startDaoPayment(treasury, { requestId: draft.id }),
        "AGENT_PAYOUT_UNSETTLED",
      );
      const rejected = await service.rejectRequest(await studio(), {
        requestId: draft.id,
        note: "Checked the agent's history: nothing went out",
      });
      expect(rejected.status).toBe("rejected");
    });

    test("a DAO payment started while the agent is pricing the payout keeps its locked amount", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      let raced = false;
      let locked: Awaited<ReturnType<typeof service.startDaoPayment>> | null = null;
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts,
        prices: {
          price: async () => {
            if (!raced) {
              raced = true;
              priceUsd = "5";
              locked = await service.startDaoPayment(requireTreasury(await studio()), {
                requestId: draft.id,
              });
              priceUsd = "6";
            }
            return { priceUsd, at: "2026-09-20T12:00:00.000Z" };
          },
        },
      });
      await refused(service.payNow(await studio(), { requestId: draft.id }), "PAYOUTS_NOT_READY");
      expect(agent.withdrawals).toHaveLength(1);
      const amount = locked!.quote.amount;
      expect(amount).toBe("120000000000000000000000000");
      transfer(31, { tokenId: "", amount });
      const linked = await service.linkProposal(requireTreasury(await studio()), {
        requestId: draft.id,
        proposalId: "31",
      });
      expect(linked.status).toBe("proposed");
      expect(linked.note).toBeNull();
    });

    test("a DAO payment can't start while an automatic payout that may have gone out is settling", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      let raced = false;
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts,
        prices: {
          price: async () => {
            if (!raced) {
              raced = true;
              agent.nextWithdraw = { status: "FAILED", details: {} };
              await service.payNow(await studio(), { requestId: draft.id }).catch(() => null);
            }
            return { priceUsd, at: "2026-09-20T12:00:00.000Z" };
          },
        },
      });
      await refused(
        service.startDaoPayment(requireTreasury(await studio()), { requestId: draft.id }),
        "AGENT_PAYOUT_UNSETTLED",
      );
      const [after] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(after?.status).toBe("approved");
      expect(after?.daoPaymentStartedAt).toBeNull();
      expect(agent.withdrawals).toHaveLength(2);
    });

    test("a proposal can't be linked while an automatic payout that may have gone out is settling", async () => {
      strongEvidence();
      const amount = "100000000000000000000000";
      const wo = await active({ tokenId: "near", budgetAmount: "1000000000000000000000000" });
      await service.collect(await studio(), { id: wo.id });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      await service.editRequest(carol(), { requestId: draft.id, requestedAmount: amount });
      await service.submitRequest(carol(), { requestId: draft.id });
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount });
      transfer(35, { tokenId: "", amount });
      let raced = false;
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts,
        proposal: async (dao, id) => {
          if (!raced) {
            raced = true;
            agent.nextWithdraw = { status: "FAILED", details: {} };
            await service.payNow(await studio(), { requestId: draft.id }).catch(() => null);
          }
          return serviceDeps.proposal(dao, id);
        },
      });
      await refused(
        service.linkProposal(requireTreasury(await studio()), {
          requestId: draft.id,
          proposalId: "35",
        }),
        "AGENT_PAYOUT_UNSETTLED",
      );
      const [after] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(after?.status).toBe("approved");
      expect(after?.proposalId).toBeNull();
      expect(await db.select().from(billings).where(eq(billings.proposalId, "35"))).toHaveLength(0);
      expect(agent.withdrawals).toHaveLength(2);
    });

    test("a scheduled retry that fails after a DAO payment started leaves the DAO payment alone", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      const held = events.filter((e) => e.type === "request.payout_blocked").length;
      let raced = false;
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts,
        prices: {
          price: async () => {
            if (!raced) {
              raced = true;
              await service.startDaoPayment(requireTreasury(await studio()), {
                requestId: draft.id,
              });
              throw new Error("price feed down");
            }
            return { priceUsd, at: "2026-09-20T12:00:00.000Z" };
          },
        },
      });
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("retry");
      const [after] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(after?.daoPaymentStartedAt).not.toBeNull();
      expect(after?.autoPayBlockedAt).toBeNull();
      expect(after?.autoPayBlockedCode).toBeNull();
      expect(after?.note).toMatch(/Being paid through a DAO proposal/);
      expect(events.filter((e) => e.type === "request.payout_blocked")).toHaveLength(held);
    });

    test("a price left by a refused automatic payout isn't enough to link a proposal", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      const [tried] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(tried?.payoutAmount).not.toBeNull();
      transfer(34, { tokenId: "", amount: tried!.payoutAmount! });
      await refused(
        service.linkProposal(requireTreasury(await studio()), {
          requestId: draft.id,
          proposalId: "34",
        }),
        "NO_QUOTE",
      );
    });

    test("starting the DAO path stops automatic payment for good; rejecting the request ends it", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      const blocked = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(blocked.autoPayBlocked).not.toBeNull();
      await service.startDaoPayment(requireTreasury(await studio()), { requestId: draft.id });
      agent.nextWithdraw = { status: "SUCCESS", details: { tx_hash: "TX9" } };
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("t1");
      await refused(service.payNow(await studio(), { requestId: draft.id }), "PAYOUTS_NOT_READY");
      expect(agent.withdrawals).toHaveLength(1);
      const [paused] = await db
        .select()
        .from(compensationRequests)
        .where(eq(compensationRequests.id, draft.id));
      expect(paused?.status).toBe("approved");
      expect(paused?.note).not.toMatch(/tried again automatically/);
      expect(paused?.daoPaymentStartedAt).not.toBeNull();
      expect(paused?.autoPayBlockedCode).toBeNull();
      const rejected = await service.rejectRequest(await studio(), {
        requestId: draft.id,
        note: "Paying it as a new request instead",
      });
      expect(rejected.status).toBe("rejected");
      expect(agent.withdrawals).toHaveLength(1);
    });

    test("a refused payout waits for funds, tells the managers once and pays on its own once funded", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      const blocked = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(blocked.status).toBe("approved");
      expect(blocked.autoPayBlocked?.reason).toMatch(/insufficient_balance/);
      expect(blocked.note).toMatch(/tried again automatically/);
      await service.tick("t1");
      expect(agent.withdrawals).toHaveLength(1);
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("t2");
      expect(agent.withdrawals).toHaveLength(2);
      const told = (await notificationsOf("studio-admin")).filter(
        (n) => n.kind === "compensation_request_payout_blocked",
      );
      expect(told).toHaveLength(1);
      agent.nextWithdraw = { status: "SUCCESS", details: { tx_hash: "TX9" } };
      await service.tick("t3");
      expect(agent.withdrawals).toHaveLength(2);
      clock = new Date(clock.getTime() + 6 * 60_000);
      const result = await service.tick("t4");
      expect(result.counts.paid).toBe(1);
      const detail = await service.get(await studio(), { id: blocked.workOrderId });
      const request = detail.requests.find((r) => r.id === draft.id);
      expect(request?.status).toBe("paid");
      expect(request?.autoPayBlocked).toBeNull();
      expect(agent.withdrawals.map((w) => w.key)).toEqual([
        `multiagency:${draft.id}:a1`,
        `multiagency:${draft.id}:a2`,
        `multiagency:${draft.id}:a3`,
      ]);
    });

    test("before approving, the admin sees that the agent can't pay it right away", async () => {
      const { draft } = await approvedRequest();
      const near = atomicToNear(usdToTokens(600_000_000n, "4.99", 24));
      const without = await createWorkOrdersService(serviceDeps).payoutReadiness(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(without).toMatchObject({ ready: false, code: "unavailable" });
      expect(
        await service.payoutReadiness(await studio(), { requestId: draft.id, amount: "600000000" }),
      ).toMatchObject({ ready: false, code: "no_agent" });
      await setUpAgent();
      const empty = await service.payoutReadiness(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(empty).toEqual({
        ready: false,
        code: "insufficient_balance",
        reason: `The agent holds 0 NEAR; this payout needs ${near} NEAR`,
        near,
        balanceNear: "0",
        priceUsd: "4.99",
      });
      agent.balanceRaw = (200n * 10n ** 24n).toString();
      agent.monthlySpentUsd = "4800";
      expect(
        await service.payoutReadiness(await studio(), { requestId: draft.id, amount: "600000000" }),
      ).toMatchObject({ ready: false, code: "over_monthly_budget", balanceNear: "200" });
      agent.monthlySpentUsd = "0";
      expect(
        await service.payoutReadiness(await studio(), { requestId: draft.id, amount: "600000000" }),
      ).toEqual({
        ready: true,
        code: null,
        reason: null,
        near,
        balanceNear: null,
        priceUsd: "4.99",
      });
      const detail = await service.get(await studio(), { id: draft.workOrderId });
      expect(detail.requests.find((r) => r.id === draft.id)?.status).toBe("submitted");
      expect(agent.withdrawals).toEqual([]);
    });

    test("the work order page warns when the agent can't cover its budget", async () => {
      const { wo } = await approvedRequest();
      await setUpAgent();
      const needed = atomicToNear(usdToTokens(1_000_000_000n, "4.99", 24));
      expect(await service.payoutCoverage(await studio(), { id: wo.id })).toEqual({
        covered: false,
        unpaid: "$1,000",
        balanceNear: "0",
        neededNear: needed,
        shortfallNear: expect.any(String),
        lowBalance: true,
        neededUsd: "1000.00",
        monthlyBudgetUsd: "5000",
        monthlyRemainingUsd: "5000.00",
        overMonthly: false,
      });
      agent.balanceRaw = (300n * 10n ** 24n).toString();
      agent.monthlySpentUsd = "4500";
      expect(await service.payoutCoverage(await studio(), { id: wo.id })).toMatchObject({
        covered: false,
        lowBalance: false,
        overMonthly: true,
        monthlyRemainingUsd: "500.00",
      });
      agent.monthlySpentUsd = "0";
      expect(await service.payoutCoverage(await studio(), { id: wo.id })).toMatchObject({
        covered: true,
      });
      const plain = createWorkOrdersService(serviceDeps);
      expect(await plain.payoutCoverage(await studio(), { id: wo.id })).toBeNull();
    });

    test("a payout on hold for funds emails the representative once, not on every retry", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("t1");
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("t2");
      expect(agent.withdrawals).toHaveLength(3);
      const held = events.filter((e) => e.type === "request.payout_blocked");
      expect(held).toHaveLength(1);
      const near = atomicToNear(usdToTokens(600_000_000n, "4.99", 24));
      expect(held[0]?.hold).toEqual({
        code: "insufficient_balance",
        reason: `The agent holds 0 NEAR; this payout needs ${near} NEAR`,
        balanceNear: "0",
        neededNear: near,
      });
      expect(held[0]?.links.settings).toBe("https://app.example/admin/settings#payouts");
      expect(held[0]?.request?.id).toBe(`${held[0]?.workOrder.id}-R1`);
      agent.monthlySpentUsd = "4800";
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("t3");
      const again = events.filter((e) => e.type === "request.payout_blocked");
      expect(again.map((e) => e.hold?.code)).toEqual([
        "insufficient_balance",
        "over_monthly_budget",
      ]);
    });

    test("an agent outage between funding holds doesn't email the same hold again", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { refuse: "insufficient_balance" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      const held = () => events.filter((e) => e.type === "request.payout_blocked").length;
      expect(held()).toBe(1);

      const readiness = payouts.readiness;
      payouts.readiness = async () => {
        throw new Error("The payout agent API is unreachable");
      };
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("outage");
      const during = await service.get(await studio(), { id: draft.workOrderId });
      expect(during.requests.find((r) => r.id === draft.id)?.autoPayBlocked?.reason).toMatch(
        /unreachable/,
      );

      payouts.readiness = readiness;
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick("back");
      expect(agent.withdrawals.length).toBeGreaterThan(1);
      expect(held()).toBe(1);
    });

    test("a payout the agent can't confirm asks for a check instead of showing it as sending", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "FAILED", details: { reason: "unknown outcome" } };
      const approved = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      const detail = await service.get(await studio(), { id: approved.workOrderId });
      const request = detail.requests.find((r) => r.id === draft.id);
      expect(request?.status).toBe("approved");
      expect(detail.progress).toMatchObject({
        waitingOn: "you",
        headline: expect.stringMatching(/needs a check before it's paid again/),
      });
      expect(detail.progress.headline).not.toMatch(/^Sending/);
      const tries = agent.withdrawals.length;
      clock = new Date(clock.getTime() + 30 * 60_000);
      await service.tick("later");
      expect(agent.withdrawals).toHaveLength(tries);
    });

    test("a builder the rules don't allow yet is paid by the scheduler once the update is signed", async () => {
      await setUpAgent();
      const { draft } = await approvedRequest();
      const approved = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "600000000",
      });
      expect(approved.status).toBe("approved");
      expect(approved.autoPayBlocked?.reason).toMatch(/sign the updated rules/);
      expect((await notificationsOf("studio-admin")).map((n) => n.kind)).toContain(
        "compensation_request_payout_blocked",
      );
      const sync = await payouts.prepare("studio", { action: "sync_policy" });
      await payouts.submit("studio", {
        correlationId: sync.correlationId,
        signedData: await agent.sign(sync.intent),
      });
      clock = new Date(clock.getTime() + 6 * 60_000);
      await service.tick();
      const detail = await service.get(await studio(), { id: approved.workOrderId });
      expect(detail.requests.find((r) => r.id === draft.id)?.status).toBe("paid");
    });

    test("the run and the tick settling the same payout record one billing", async () => {
      const { draft } = await approvedRequest();
      await setUpAgent();
      agent.nextWithdraw = { status: "PROCESSING" };
      await service.approveRequest(await studio(), { requestId: draft.id, amount: "600000000" });
      agent.statuses.set("pay-1", { status: "SUCCESS", details: { tx_hash: "TXONCE" } });
      await Promise.all([service.run("r"), service.tick("t")]);
      const rows = await db
        .select()
        .from(billings)
        .where(eq(billings.proposalId, "intents:TXONCE"));
      expect(rows).toHaveLength(1);
      const paid = (await notificationsOf("carol")).filter(
        (n) => n.kind === "compensation_request_paid",
      );
      expect(paid).toHaveLength(1);
    });

    test("only what MultiAgency prepared, signed by the owner, is accepted", async () => {
      await payouts.saveSettings("studio", "studio-admin", {
        ownerAccountId: "someone-else.near",
        monthlyBudgetUsd: "5000",
        maxPayoutNear: "500",
      });
      await refused(
        payouts.prepare("studio", {
          action: "create_agent",
          publicKey: `ed25519:${"1".repeat(44)}`,
        }),
        "OWNER_MISMATCH",
      );
      await payouts.saveSettings("studio", "studio-admin", {
        ownerAccountId: "rita.near",
        monthlyBudgetUsd: "5000",
        maxPayoutNear: "500",
      });
      const create = await payouts.prepare("studio", {
        action: "create_agent",
        publicKey: `ed25519:${"1".repeat(44)}`,
      });
      await refused(
        payouts.submit("studio", {
          correlationId: create.correlationId,
          signedData: { standard: "nep366", payload: { receiverId: "evil.near", actions: [] } },
        }),
        "SIGNED_PAYLOAD_MISMATCH",
      );
      expect((await payouts.view("studio")).blockers).toEqual([
        "Create the payout agent with your wallet",
      ]);
    });
  });

  describe("automation", () => {
    async function noEvidenceRequest() {
      const wo = await active();
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      const submitted = await service.submitRequest(carol(), { requestId: draft.id });
      return { wo, request: submitted };
    }

    test("approving a request with no approved work needs an explicit confirmation", async () => {
      const { request } = await noEvidenceRequest();
      expect(request.authorizedEvidence).toBe(0);
      await refused(
        service.approveRequest(await studio(), { requestId: request.id, amount: "100000000" }),
        "NO_EVIDENCE",
      );
      const approved = await service.approveRequest(await studio(), {
        requestId: request.id,
        amount: "100000000",
        allowWithoutEvidence: true,
      });
      expect(approved.status).toBe("approved");
    });

    test("confirming merged work counts as evidence", async () => {
      github.issue(REPO, 7).assign("carol-gh", "2026-09-02T10:00:00Z");
      github.pull(REPO, 77, {
        author: "carol-gh",
        createdAt: "2026-09-03T10:00:00Z",
        mergedAt: "2026-09-04T10:00:00Z",
        mergedBy: "writer-gh",
        closes: [7],
      });
      const { wo, request } = await noEvidenceRequest();
      const pr = (await service.get(await studio(), { id: wo.id })).evidence.find((e) =>
        e.url.endsWith("/pull/77"),
      );
      expect(pr?.authorized).toBe(false);
      const approved = await service.approveRequest(await studio(), {
        requestId: request.id,
        amount: "100000000",
        confirmEvidenceIds: [pr!.id],
      });
      expect(approved.status).toBe("approved");
    });

    test("drafting collects the latest evidence first, and a GitHub outage doesn't stop it", async () => {
      const wo = await active();
      strongEvidence();
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      expect(draft.contributionsMd).toContain("pull/200");
      await service.rejectRequest(await studio(), {
        requestId: (await service.submitRequest(carol(), { requestId: draft.id })).id,
        note: "Split it",
      });
      github.failNext("getRepoOwnership", new Error("GitHub is down"));
      const again = await service.mineDraftRequest(carol(), { id: wo.id });
      expect(again.status).toBe("draft");
    });

    test("the default amount is the budget share of the covered days, capped by what remains", async () => {
      const wo = await active();
      const half = await service.mineDraftRequest(carol(), {
        id: wo.id,
        coversFrom: "2026-09-01",
        coversTo: "2026-09-15",
      });
      expect(half.requestedAmount).toBe("500000000");
      const submitted = await service.submitRequest(carol(), { requestId: half.id });
      await service.approveRequest(await studio(), {
        requestId: submitted.id,
        amount: "700000000",
        allowWithoutEvidence: true,
      });
      const rest = await service.mineDraftRequest(carol(), {
        id: wo.id,
        coversFrom: "2026-09-16",
        coversTo: "2026-09-30",
      });
      expect(rest.requestedAmount).toBe("300000000");
    });

    test("signing in Documenso activates it from the background tick", async () => {
      const documenso = new FakeDocumenso();
      service = createWorkOrdersService({ ...serviceDeps, esign: documenso });
      const created = await service.create(
        await studio(),
        fields({ representativeName: "Rita Rep", representativeEmail: "rita@example.com" }),
      );
      await service.offer(await studio(), { id: created.id });
      documenso.sign("representative", "2026-09-20T13:00:00.000Z");
      documenso.sign("contractor", "2026-09-20T14:00:00.000Z");
      const result = await service.tick();
      expect(result.counts.signaturesChecked).toBe(1);
      const [row] = await db.select().from(workOrders).where(eq(workOrders.id, created.id));
      expect(row?.status).toBe("active");
      expect(row?.activatedBy).toBe("system");
      expect(events.map((e) => e.type)).toContain("work_order.active");
    });

    test("a signed work order that can't start tells the managers, then starts once it can", async () => {
      const created = await service.create(
        await studio(),
        fields({ representativeName: "Rita Rep", contractorEmail: "carol@example.com" }),
      );
      await service.offer(await studio(), { id: created.id });
      await signAsBuilder(created.id);
      await db
        .update(workOrders)
        .set({ payeeConfirmedAt: null, payeeConfirmedBy: null })
        .where(eq(workOrders.id, created.id));
      const signed = await service.countersign(await studio(), {
        id: created.id,
        name: "Rita Rep",
      });
      expect(signed.status).toBe("accepted");
      const told = (await notificationsOf("studio-admin")).find(
        (n) => n.kind === "work_order_activation_blocked",
      );
      expect(told?.payload).toContain("hasn't confirmed the payout account");
      await db
        .update(workOrders)
        .set({ payeeConfirmedAt: clock, payeeConfirmedBy: "carol" })
        .where(eq(workOrders.id, created.id));
      const result = await service.tick();
      expect(result.counts.activated).toBe(1);
      expect((await service.get(await studio(), { id: created.id })).status).toBe("active");
    });

    test("activation asks the payout agent to allow the builder and says what's missing", async () => {
      const allowed: string[] = [];
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts: {
          readiness: async () => ({ ready: false, reason: "No payout agent" }),
          send: async () => {
            throw new Error("not used");
          },
          refresh: async (payout) => payout,
          latest: async () => null,
          ensurePayees: async (organizationId) => {
            allowed.push(organizationId);
            return { ok: false, reason: "Sign the updated rules" };
          },
        },
      });
      const wo = await active({ tokenId: "usd" });
      expect(wo.status).toBe("active");
      expect(allowed).toEqual(["studio"]);
      const told = (await notificationsOf("studio-admin")).find(
        (n) => n.kind === "work_order_payee_not_allowed",
      );
      expect(told?.payload).toContain("Sign the updated rules");
    });

    test("an Agency without a payout agent approves without a note or a retry", async () => {
      service = createWorkOrdersService({
        ...serviceDeps,
        payouts: {
          readiness: async () => ({ ready: false, reason: "No payout agent" }),
          send: async () => {
            throw new Error("not used");
          },
          refresh: async (payout) => payout,
          latest: async () => null,
        },
      });
      const wo = await active({ tokenId: "usd" });
      const draft = await service.mineDraftRequest(carol(), { id: wo.id });
      await service.submitRequest(carol(), { requestId: draft.id });
      const approved = await service.approveRequest(await studio(), {
        requestId: draft.id,
        amount: "100000000",
        allowWithoutEvidence: true,
      });
      expect(approved.note).toBeNull();
      expect(approved.autoPayBlocked).toBeNull();
    });

    test("evidence windows follow the Agency's time zone", async () => {
      github.pull(REPO, 300, {
        author: "carol-gh",
        createdAt: "2026-08-31T19:30:00Z",
        mergedAt: "2026-08-31T20:00:00Z",
      });
      const utc = await active();
      expect(utc.timeZone).toBe("UTC");
      const inUtc = await service.collect(await studio(), { id: utc.id });
      expect(inUtc.evidence.some((e) => e.url.endsWith("/pull/300"))).toBe(false);
      service = createWorkOrdersService({ ...serviceDeps, timeZone: "Asia/Karachi" });
      const inKarachi = await service.collect(await studio(), { id: utc.id });
      expect(inKarachi.timeZone).toBe("Asia/Karachi");
      expect(inKarachi.evidence.some((e) => e.url.endsWith("/pull/300"))).toBe(true);
    });

    test("the period ends at midnight in the Agency's time zone", async () => {
      service = createWorkOrdersService({ ...serviceDeps, timeZone: "Asia/Karachi" });
      const wo = await active({ graceDays: 0 });
      clock = new Date("2026-09-30T19:30:00.000Z");
      await service.run();
      expect((await service.get(await studio(), { id: wo.id })).status).toBe("ended");
    });

    test("the scheduler runs the tick often and the full run rarely, never two at once", async () => {
      vi.useFakeTimers();
      try {
        let running = 0;
        let overlap = false;
        const calls: string[] = [];
        const job = (name: string) => async () => {
          calls.push(name);
          running += 1;
          if (running > 1) overlap = true;
          await new Promise((resolve) => setTimeout(resolve, 20_000));
          running -= 1;
        };
        const timers = scheduleWorkOrders(
          { tick: job("tick"), run: job("run") },
          { tickSeconds: 15, runMinutes: 360, firstRunSeconds: 30 },
        );
        await vi.advanceTimersByTimeAsync(120_000);
        stopWorkOrders(timers);
        expect(calls[0]).toBe("tick");
        expect(calls).toContain("run");
        expect(calls.filter((c) => c === "run")).toHaveLength(1);
        expect(overlap).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("importing repositories from GitHub", () => {
    test("lists an organization's public repositories", async () => {
      github.orgs.set("nearbuilders", [
        {
          fullName: "NEARBuilders/citynode.app",
          url: "https://github.com/NEARBuilders/citynode.app",
          description: "City node",
          pushedAt: "2026-10-01T00:00:00Z",
        },
      ]);
      const listed = await service.githubRepos(await studio(), { org: "NEARBuilders" });
      expect(listed.repos.map((r) => r.fullName)).toEqual(["NEARBuilders/citynode.app"]);
    });

    test("an unknown organization or a GitHub outage is a clear error", async () => {
      await refused(service.githubRepos(await studio(), { org: "nobody" }), "GITHUB_ORG_NOT_FOUND");
      github.orgs.set("down", []);
      github.failNext("listOrgRepos", new Error("timeout"));
      await refused(service.githubRepos(await studio(), { org: "down" }), "GITHUB_FAILED");
    });
  });

  describe("builder defaults for a new work order", () => {
    const rival = () => world.manager("rival-admin", "rival");

    test("the profile login, a linked account email, and no email demand without e-signature", async () => {
      expect(await service.builderDefaults(await studio(), { nearAccount: CAROL })).toEqual({
        githubLogin: "carol-gh",
        contractorEmail: null,
        accountEmail: true,
        needsEmails: false,
      });
    });

    test("an unknown builder gets empty defaults, and e-signature asks for emails", async () => {
      service = createWorkOrdersService({ ...serviceDeps, esign: new FakeDocumenso() });
      expect(await service.builderDefaults(await studio(), { nearAccount: "ghost.near" })).toEqual({
        githubLogin: null,
        contractorEmail: null,
        accountEmail: false,
        needsEmails: true,
      });
    });

    test("no account email when the linked user has none", async () => {
      service = createWorkOrdersService({ ...serviceDeps, userEmail: async () => null });
      const defaults = await service.builderDefaults(await studio(), { nearAccount: CAROL });
      expect(defaults.accountEmail).toBe(false);
    });

    test("the remembered login and latest email stay inside the organization", async () => {
      const first = await service.create(
        await studio(),
        fields({
          builderNearAccount: "nogit.near",
          githubLogin: "nogit-gh",
          contractorEmail: "old@nogit.example",
        }),
      );
      clock = new Date("2026-09-21T12:00:00.000Z");
      await service.create(
        await studio(),
        fields({
          builderNearAccount: "nogit.near",
          githubLogin: "nogit-gh",
          contractorEmail: "new@nogit.example",
        }),
      );
      clock = new Date("2026-09-22T12:00:00.000Z");
      const leaked = await service.create(
        await studio(),
        fields({
          builderNearAccount: "nogit.near",
          githubLogin: "nogit-gh",
          contractorEmail: "rival@nogit.example",
        }),
      );
      await db
        .update(workOrders)
        .set({ organizationId: "rival", githubLogin: "rival-gh" })
        .where(eq(workOrders.id, leaked.id));
      await db.update(workOrders).set({ contractorEmail: null }).where(eq(workOrders.id, first.id));

      expect(await service.builderDefaults(await studio(), { nearAccount: "nogit.near" })).toEqual({
        githubLogin: "nogit-gh",
        contractorEmail: "new@nogit.example",
        accountEmail: true,
        needsEmails: false,
      });
      expect(await service.builderDefaults(await rival(), { nearAccount: "nogit.near" })).toEqual({
        githubLogin: "rival-gh",
        contractorEmail: "rival@nogit.example",
        accountEmail: true,
        needsEmails: false,
      });
    });

    test("the latest login on the organization's work orders fills in when none is remembered", async () => {
      await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near", githubLogin: "old-gh" }),
      );
      clock = new Date("2026-09-21T12:00:00.000Z");
      await service.create(
        await studio(),
        fields({ builderNearAccount: "nogit.near", githubLogin: "new-gh" }),
      );
      await db.delete(organizationBuilderLogins);

      expect(
        (await service.builderDefaults(await studio(), { nearAccount: "nogit.near" })).githubLogin,
      ).toBe("new-gh");
      expect(
        (await service.builderDefaults(await rival(), { nearAccount: "nogit.near" })).githubLogin,
      ).toBeNull();
    });
  });
});
