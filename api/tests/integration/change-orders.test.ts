import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, proposals } from "../../src/db/schema";
import { createBudget, listBudgets } from "../../src/services/budgets";
import type { ChangeOrderItemInput } from "../../src/services/change-orders";
import type { DaoProposalStatus } from "../../src/services/sputnik";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const STUDIO_DAO = "studio.sputnik-dao.near";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "beta", name: "Beta Labs", slug: "beta" },
  { id: "rival", name: "Rival", slug: "rival", daoAccountId: "rival.sputnik-dao.near" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-member", organizationId: "studio", role: "member" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
  { userId: "beta-owner", organizationId: "beta", role: "owner" as const },
  { userId: "rival-owner", organizationId: "rival", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

const projects = [project("site", "studio"), project("app", "studio"), project("own", "studio")];

const plan = (projectId: string, amount: string): ChangeOrderItemInput => ({
  projectId,
  tokenId: "near",
  kind: "plan_change",
  amount,
});

const move = (projectId: string | null, amount: string): ChangeOrderItemInput => ({
  projectId,
  tokenId: "near",
  kind: "one_off_move",
  amount,
});

describe("change orders and the Allocation plan", () => {
  let pg: PGlite;
  let db: Database;
  let today: Date;
  let world: Awaited<ReturnType<typeof engagementWorld>>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    today = new Date("2026-09-15T12:00:00Z");
    world = await engagementWorld(
      db,
      { organizations, members, users, projects },
      { now: () => today },
    );
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acme = () => world.manager("acme-owner", "acme");
  const acmeMember = () => world.member("acme-member", "acme");
  const beta = () => world.manager("beta-owner", "beta");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  async function engagement(client: "acme" | "beta" = "acme") {
    const proposed = await world.engagements.propose(await studio(), {
      slug: client,
      name: client === "acme" ? "Acme Corp" : "Beta Labs",
    });
    await world.engagements.accept(await world.manager(`${client}-owner`, client), proposed.id);
    for (const projectId of ["site", "app"]) {
      await world.engagements.share(await studio(), { engagementId: proposed.id, projectId });
    }
    return proposed.id;
  }

  const record = async (engagementId: string, amount: string, period: string) =>
    world.prepayments.record(await studio(), { engagementId, tokenId: "near", amount, period });

  const propose = async (
    scope: Parameters<typeof world.changeOrders.propose>[0],
    engagementId: string,
    items: ChangeOrderItemInput[],
    effective: "now" | "next_period" = "next_period",
  ) => world.changeOrders.propose(scope, { engagementId, effective, items });

  async function agreed(
    engagementId: string,
    items: ChangeOrderItemInput[],
    effective: "now" | "next_period" = "next_period",
  ) {
    const proposed = await propose(await studio(), engagementId, items, effective);
    return world.changeOrders.approve(await acme(), { id: proposed.id });
  }

  async function attributed(engagementId: string) {
    const { data } = await listBudgets(db, { projectIds: null, engagementId, limit: 200 });
    const byProject: Record<string, string> = {};
    for (const row of data) {
      byProject[row.projectId] = (
        BigInt(byProject[row.projectId] ?? "0") + BigInt(row.amount)
      ).toString();
    }
    return byProject;
  }

  const balance = async (engagementId: string) =>
    (await world.prepayments.balance(await studio(), { engagementId })).data[0]?.balance ?? "0";

  const planLines = async (engagementId: string) =>
    (await world.changeOrders.plan(await acmeMember(), { engagementId })).lines.map((l) => [
      l.projectId,
      l.amount,
      l.effectiveFrom,
    ]);

  let proposalCounter = 0;
  async function bill(projectId: string, amount: string, paid: boolean) {
    proposalCounter += 1;
    if (paid) {
      await db.insert(proposals).values({
        daoAccountId: STUDIO_DAO,
        proposalId: proposalCounter,
        proposer: "admin.near",
        description: "payout",
        status: "Approved",
        kindType: "Transfer",
        transferTokenId: "near",
        transferReceiverId: "dev.near",
        transferAmount: amount,
        submissionTime: "1700000000000000000",
      });
    }
    await db.insert(billings).values({
      id: crypto.randomUUID(),
      projectId,
      nearAccount: "dev.near",
      tokenId: "near",
      amount,
      proposalId: paid ? String(proposalCounter) : `pending-${proposalCounter}`,
    });
  }

  describe("deciding", () => {
    test("only owners and admins of the side that did not propose can decide", async () => {
      const id = await engagement();
      const proposed = await propose(await studio(), id, [plan("site", "300")]);

      expect(proposed).toMatchObject({
        status: "proposed",
        proposedBy: { side: "agency", organizationId: "studio" },
        canWithdraw: true,
        canDecide: false,
      });
      await expect(
        world.changeOrders.approve(await studio(), { id: proposed.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        world.changeOrders.approve(await acmeMember(), { id: proposed.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        world.changeOrders.reject(await world.manager("rival-owner", "rival"), {
          id: proposed.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const listed = (await world.changeOrders.list(await acme(), { engagementId: id })).data;
      expect(listed).toEqual([expect.objectContaining({ id: proposed.id, canDecide: true })]);

      const rejected = await world.changeOrders.reject(await acme(), { id: proposed.id });
      expect(rejected).toMatchObject({ status: "rejected", decidedByUserId: "acme-owner" });
      await expect(
        world.changeOrders.approve(await acme(), { id: proposed.id }),
      ).rejects.toMatchObject({ data: { reason: "NOT_PROPOSED" } });
      expect(await planLines(id)).toEqual([]);
      expect(await inbox("acme-owner")).toContain("change_order_proposed");
      expect(await inbox("studio-admin")).toContain("change_order_rejected");
    });

    test("a Client's Change order is decided by the Agency", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const proposed = await propose(await acme(), id, [move("site", "400")], "now");

      await expect(
        world.changeOrders.approve(await acme(), { id: proposed.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const approved = await world.changeOrders.approve(await studio(), { id: proposed.id });

      expect(approved.status).toBe("applied");
      expect(await inbox("acme-owner")).toContain("change_order_approved");
      expect(await inbox("studio-admin")).toContain("change_order_proposed");
    });

    test("only the proposing side can withdraw, and only while proposed", async () => {
      const id = await engagement();
      const proposed = await propose(await acme(), id, [plan("site", "300")]);

      await expect(
        world.changeOrders.withdraw(await studio(), { id: proposed.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const withdrawn = await world.changeOrders.withdraw(await acme(), { id: proposed.id });

      expect(withdrawn.status).toBe("withdrawn");
      await expect(
        world.changeOrders.withdraw(await acme(), { id: proposed.id }),
      ).rejects.toMatchObject({ data: { reason: "NOT_PROPOSED" } });
      await expect(
        world.changeOrders.approve(await studio(), { id: proposed.id }),
      ).rejects.toMatchObject({ data: { reason: "NOT_PROPOSED" } });
      expect(await inbox("studio-admin")).toContain("change_order_withdrawn");
    });

    test("Client members read the plan and history but cannot act", async () => {
      const id = await engagement();
      const proposed = await propose(await studio(), id, [plan("site", "300")]);

      const listed = (await world.changeOrders.list(await acmeMember(), { engagementId: id })).data;
      expect(listed).toEqual([
        expect.objectContaining({ id: proposed.id, canDecide: false, canWithdraw: false }),
      ]);
      await expect(propose(await acmeMember(), id, [plan("app", "1")])).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        world.changeOrders.approve(await acmeMember(), { id: proposed.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("lists the Change orders awaiting the viewer's side", async () => {
      const id = await engagement();
      const proposed = await propose(await studio(), id, [plan("site", "300")]);
      await propose(await acme(), id, [plan("app", "100")]);

      expect((await world.changeOrders.awaiting(await acme())).data.map((c) => c.id)).toEqual([
        proposed.id,
      ]);
      expect((await world.changeOrders.awaiting(await studio())).data).toHaveLength(1);
      await world.changeOrders.approve(await acme(), { id: proposed.id });
      expect((await world.changeOrders.awaiting(await acme())).data).toEqual([]);
    });

    test("refuses malformed items and Projects that are not shared", async () => {
      const id = await engagement();
      const scope = await studio();

      await expect(
        propose(scope, id, [{ ...plan("site", "1"), projectId: null }]),
      ).rejects.toMatchObject({ data: { reason: "PLAN_NEEDS_PROJECT" } });
      await expect(propose(scope, id, [plan("own", "100")])).rejects.toMatchObject({
        data: { reason: "NOT_SHARED" },
      });
      await expect(propose(scope, id, [plan("site", "0")])).rejects.toMatchObject({
        data: { reason: "INVALID_AMOUNT" },
      });
      await expect(
        propose(scope, id, [move("site", "100"), move(null, "-50")]),
      ).rejects.toMatchObject({ data: { reason: "UNBALANCED" } });
      await expect(propose(scope, id, [])).rejects.toMatchObject({
        data: { reason: "NO_ITEMS" },
      });
    });
  });

  describe("the Allocation plan", () => {
    test("the first plan is a Change order by the Agency, applied from the next period once per period", async () => {
      const id = await engagement();
      const approved = await agreed(id, [plan("site", "300"), plan("app", "200")]);

      expect(approved).toMatchObject({ status: "applied", effectivePeriod: "2026-10" });
      expect(await planLines(id)).toEqual([
        ["site", "300", "2026-10"],
        ["app", "200", "2026-10"],
      ]);

      await record(id, "1000", "2026-09");
      expect(await attributed(id)).toEqual({});

      await record(id, "1000", "2026-10");
      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ site: "300", app: "200" });
      expect(await balance(id)).toBe("2500");
      expect((await world.changeOrders.plan(await studio(), { engagementId: id })).nextPeriod).toBe(
        "2026-11",
      );
    });

    test("plan changes take effect from the next period's Prepayment, even when effective now", async () => {
      const id = await engagement();
      await agreed(id, [plan("site", "300")]);
      today = new Date("2026-10-03T09:00:00Z");
      await record(id, "5000", "2026-10");

      const changed = await agreed(id, [plan("site", "100"), plan("app", "50")], "now");

      expect(changed.effectivePeriod).toBe("2026-11");
      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ site: "300" });
      await record(id, "1000", "2026-11");
      expect(await attributed(id)).toEqual({ site: "700", app: "50" });
      expect(await planLines(id)).toEqual([
        ["site", "400", "2026-11"],
        ["app", "50", "2026-11"],
      ]);
    });

    test("a late Prepayment for an earlier period uses the plan that was current then", async () => {
      const id = await engagement();
      await agreed(id, [plan("site", "300")]);
      today = new Date("2026-11-05T09:00:00Z");
      await record(id, "5000", "2026-11");
      await agreed(id, [plan("site", "-300"), plan("app", "100")]);

      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ site: "600" });
      await record(id, "1000", "2026-12");
      expect(await attributed(id)).toEqual({ site: "600", app: "100" });
    });

    test("skips plan lines that no longer fit the Prepaid balance and notifies both sides", async () => {
      const id = await engagement();
      await agreed(id, [plan("site", "600"), plan("app", "600")]);

      await record(id, "1000", "2026-10");

      expect(await attributed(id)).toEqual({ site: "600" });
      const { applications } = await world.changeOrders.plan(await studio(), { engagementId: id });
      expect(applications).toEqual([
        expect.objectContaining({
          period: "2026-10",
          shortfall: [
            {
              projectId: "app",
              tokenId: "near",
              amount: "600",
              reason: "PREPAID_BALANCE_EXCEEDED",
            },
          ],
        }),
      ]);
      expect(await inbox("acme-owner")).toContain("plan_shortfall");
      expect(await inbox("studio-admin")).toContain("plan_shortfall");

      await record(id, "5000", "2026-10");
      expect(await attributed(id)).toEqual({ site: "600" });
    });

    test("a plan line cannot go below zero", async () => {
      const id = await engagement();
      await agreed(id, [plan("site", "300")]);

      const failed = await agreed(id, [plan("site", "-400")]);

      expect(failed).toMatchObject({ status: "failed", failureReason: "PLAN_BELOW_ZERO" });
      expect(await planLines(id)).toEqual([["site", "300", "2026-10"]]);
    });
  });

  describe("one-off moves", () => {
    test("apply on approval when effective now, moving Prepaid balance into the Project", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");

      const applied = await agreed(id, [move("site", "400")], "now");

      expect(applied.status).toBe("applied");
      expect(applied.items).toEqual([move("site", "400"), move(null, "-400")]);
      expect(await attributed(id)).toEqual({ site: "400" });
      expect(await balance(id)).toBe("600");
    });

    test("wait for the next period's Prepayment when effective next period", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");

      const approved = await agreed(id, [move("site", "400"), plan("app", "100")]);

      expect(approved).toMatchObject({ status: "approved", effectivePeriod: "2026-10" });
      expect(await attributed(id)).toEqual({});
      expect(await planLines(id)).toEqual([]);

      await record(id, "500", "2026-10");

      const [history] = (await world.changeOrders.list(await acme(), { engagementId: id })).data;
      expect(history?.status).toBe("applied");
      expect(await attributed(id)).toEqual({ site: "400", app: "100" });
      expect(await balance(id)).toBe("1000");
    });

    test("move unspent budget between Projects", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("site", "600")], "now");

      const moved = await agreed(id, [move("site", "-250"), move("app", "250")], "now");

      expect(moved.items).toEqual([move("site", "-250"), move("app", "250")]);
      expect(await attributed(id)).toEqual({ site: "350", app: "250" });
      expect(await balance(id)).toBe("400");
    });
  });

  describe("limits at apply time", () => {
    test("two approvals that together exceed the Prepaid balance leave one applied and one failed", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const first = await propose(await acme(), id, [move("site", "700")], "now");
      const second = await propose(await acme(), id, [move("app", "700")], "now");

      const decided = await Promise.all([
        world.changeOrders.approve(await studio(), { id: first.id }),
        world.changeOrders.approve(await studio(), { id: second.id }),
      ]);

      expect(decided.map((c) => c.status).sort()).toEqual(["applied", "failed"]);
      expect(decided.find((c) => c.status === "failed")?.failureReason).toBe(
        "PREPAID_BALANCE_EXCEEDED",
      );
      expect(await balance(id)).toBe("300");
      expect(await inbox("acme-owner")).toContain("change_order_failed");
    });

    test("an over-allocation valid at proposal fails when the balance was used in between", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const later = await propose(await acme(), id, [move("app", "600")], "now");
      await agreed(id, [move("site", "600")], "now");

      const failed = await world.changeOrders.approve(await studio(), { id: later.id });

      expect(failed).toMatchObject({ status: "failed", failureReason: "PREPAID_BALANCE_EXCEEDED" });
      expect(await attributed(id)).toEqual({ site: "600" });
    });

    test("a pull-back cannot exceed the Engagement's attributed budget on a co-funded Project", async () => {
      const acmeId = await engagement("acme");
      const betaId = await engagement("beta");
      await record(acmeId, "1000", "2026-09");
      await record(betaId, "1000", "2026-09");
      await agreed(acmeId, [move("site", "300")], "now");
      const betaMove = await propose(await studio(), betaId, [move("site", "500")], "now");
      await world.changeOrders.approve(await beta(), { id: betaMove.id });
      await createBudget(db, {
        projectId: "site",
        tokenId: "near",
        amount: "1000",
        note: null,
        actorAccountId: "admin.near",
        fundingDaoAccountId: STUDIO_DAO,
      });

      const tooMuch = await agreed(acmeId, [move("site", "-400")], "now");
      expect(tooMuch).toMatchObject({
        status: "failed",
        failureReason: "ATTRIBUTED_BUDGET_EXCEEDED",
      });

      const pulled = await agreed(acmeId, [move("site", "-300")], "now");
      expect(pulled.status).toBe("applied");
      expect(pulled.items).toEqual([move("site", "-300"), move(null, "300")]);
      expect(await balance(acmeId)).toBe("1000");
      expect(await attributed(betaId)).toEqual({ site: "500" });
    });

    test("a pull-back cannot take a Project below what is Committed or Paid, rechecked at approval", async () => {
      const acmeId = await engagement("acme");
      const betaId = await engagement("beta");
      await record(acmeId, "1000", "2026-09");
      await record(betaId, "1000", "2026-09");
      await agreed(acmeId, [move("site", "500")], "now");
      const betaMove = await propose(await studio(), betaId, [move("site", "500")], "now");
      await world.changeOrders.approve(await beta(), { id: betaMove.id });
      const pullBack = await propose(await acme(), acmeId, [move("site", "-300")], "now");

      await bill("site", "600", true);
      await bill("site", "200", false);

      const failed = await world.changeOrders.approve(await studio(), { id: pullBack.id });
      expect(failed).toMatchObject({ status: "failed", failureReason: "REMAINING_EXCEEDED" });
      expect(await attributed(acmeId)).toEqual({ site: "500" });

      const fits = await agreed(acmeId, [move("site", "-200")], "now");
      expect(fits.status).toBe("applied");
      expect(await attributed(acmeId)).toEqual({ site: "300" });
    });
  });

  describe("chain statuses", () => {
    let open: number;
    let fetches: { proposalId: string; insideLock: boolean }[];
    let statuses: Record<string, DaoProposalStatus>;
    let onFetch: () => Promise<void>;
    let watched: Database;

    beforeEach(async () => {
      open = 0;
      fetches = [];
      statuses = {};
      onFetch = async () => {};
      await pg.close();
      const { PGlite } = await import("@electric-sql/pglite");
      pg = new PGlite("memory://");
      await applyAllMigrations(pg);
      db = drizzle(pg, { schema }) as unknown as Database;
      watched = new Proxy(db, {
        get(target, property) {
          if (property === "transaction") {
            return async (run: (tx: Database) => Promise<unknown>) => {
              open += 1;
              try {
                return await target.transaction(run as never);
              } finally {
                open -= 1;
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Database;
      world = await engagementWorld(
        watched,
        { organizations, members, users, projects },
        {
          now: () => today,
          chainStatus: async (_db, _dao, proposalId) => {
            fetches.push({ proposalId, insideLock: open > 0 });
            await onFetch();
            return statuses[proposalId] ?? "InProgress";
          },
        },
      );
    });

    async function billing(proposalId: string, amount: string) {
      await db.insert(billings).values({
        id: crypto.randomUUID(),
        projectId: "site",
        nearAccount: "dev.near",
        tokenId: "near",
        amount,
        proposalId,
      });
    }

    test("are fetched before the Engagement is locked, on approval and on plan application", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("site", "600")], "now");
      await billing("101", "200");
      statuses["101"] = "Approved";

      const now = await agreed(id, [move("site", "-100")], "now");
      const later = await agreed(id, [move("site", "-100")]);
      await record(id, "1", "2026-10");

      expect(now.status).toBe("applied");
      expect(
        (await world.changeOrders.list(await acme(), { engagementId: id })).data.find(
          (c) => c.id === later.id,
        )?.status,
      ).toBe("applied");
      expect(fetches.length).toBeGreaterThanOrEqual(2);
      expect(fetches.filter((f) => f.insideLock)).toEqual([]);
    });

    test("a billing created after the statuses were fetched counts as committed", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("site", "600")], "now");
      await billing("103", "100");
      const pullBack = await propose(await acme(), id, [move("site", "-400")], "now");
      onFetch = async () => {
        onFetch = async () => {};
        await billing("104", "300");
      };

      const failed = await world.changeOrders.approve(await studio(), { id: pullBack.id });

      expect(failed).toMatchObject({ status: "failed", failureReason: "REMAINING_EXCEEDED" });
      expect(fetches.map((f) => f.proposalId)).toEqual(["103"]);
    });
  });

  describe("lifecycle", () => {
    test("ending an Engagement withdraws its pending Change orders", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const proposed = await propose(await acme(), id, [plan("site", "100")]);
      const waiting = await agreed(id, [move("site", "100")]);
      const done = await agreed(id, [plan("app", "100")]);

      await world.engagements.end(await acme(), id);

      const statuses = Object.fromEntries(
        (await world.changeOrders.list(await acmeMember(), { engagementId: id })).data.map((c) => [
          c.id,
          c.status,
        ]),
      );
      expect(statuses).toEqual({
        [proposed.id]: "withdrawn",
        [waiting.id]: "withdrawn",
        [done.id]: "applied",
      });
      await expect(propose(await studio(), id, [plan("site", "1")])).rejects.toMatchObject({
        data: { reason: "NOT_ACTIVE" },
      });
    });

    test("a Project in the plan cannot be unshared until a Change order removes it", async () => {
      const id = await engagement();
      await agreed(id, [plan("site", "300")]);

      await expect(
        world.engagements.unshare(await studio(), { engagementId: id, projectId: "site" }),
      ).rejects.toMatchObject({ data: { reason: "PLAN_LINES" } });

      await agreed(id, [plan("site", "-300")]);
      const after = await world.engagements.unshare(await studio(), {
        engagementId: id,
        projectId: "site",
      });
      expect(after.projectIds).toEqual(["app"]);
    });
  });
});
