import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { billings } from "../../src/db/schema";
import { listBudgets, writeEngagementEntries } from "../../src/services/budgets";
import type { ChangeOrderItemInput } from "../../src/services/change-orders";
import type { DaoProposalStatus } from "../../src/services/sputnik";
import { engagementWorld, refused, STUDIO_SEED } from "../fakes/engagements";
import { migratedDatabase } from "./_pg";

const item =
  (kind: ChangeOrderItemInput["kind"]) =>
  (projectId: string | null, amount: string): ChangeOrderItemInput => ({
    projectId,
    tokenId: "near",
    kind,
    amount,
  });
const plan = item("plan_change");
const move = item("one_off_move");

type Effective = "now" | "next_period";

describe("change orders and the Allocation plan", () => {
  const database = migratedDatabase({ perTest: true });
  let today: Date;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let open: number;
  let fetches: { proposalId: string; insideLock: boolean }[];
  let statuses: Record<string, DaoProposalStatus>;
  let onFetch: () => Promise<void>;

  beforeEach(async () => {
    today = new Date("2026-09-15T12:00:00Z");
    open = 0;
    fetches = [];
    statuses = {};
    onFetch = async () => {};
    const db = database.db;
    const transaction = async (run: (tx: Database) => Promise<unknown>) => {
      open += 1;
      try {
        return await db.transaction(run as never);
      } finally {
        open -= 1;
      }
    };
    const watched = Object.create(db, { transaction: { value: transaction } }) as Database;
    world = await engagementWorld(watched, STUDIO_SEED, {
      now: () => today,
      chainStatus: async (_db, _dao, proposalId) => {
        fetches.push({ proposalId, insideLock: open > 0 });
        await onFetch();
        return statuses[proposalId] ?? "InProgress";
      },
    });
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acme = () => world.manager("acme-owner", "acme");
  const acmeMember = () => world.member("acme-member", "acme");
  const globex = () => world.manager("globex-owner", "globex");
  const forbidden = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  const engagement = async (client: "acme" | "globex" = "acme") =>
    (await world.activeEngagement(client, ["p1", "p2"])).id;

  const record = async (engagementId: string, amount: string, period: string) =>
    world.prepayments.record(await studio(), { engagementId, tokenId: "near", amount, period });

  const propose = async (
    scope: Parameters<typeof world.changeOrders.propose>[0],
    engagementId: string,
    items: ChangeOrderItemInput[],
    effective: Effective = "next_period",
  ) => world.changeOrders.propose(scope, { engagementId, effective, items });

  async function agreed(
    engagementId: string,
    items: ChangeOrderItemInput[],
    effective: Effective = "next_period",
  ) {
    const proposed = await propose(await studio(), engagementId, items, effective);
    return world.changeOrders.approve(await acme(), { id: proposed.id });
  }

  async function attributed(engagementId: string) {
    const { data } = await listBudgets(database.db, { projectIds: null, engagementId, limit: 200 });
    const byProject: Record<string, bigint> = {};
    for (const row of data)
      byProject[row.projectId] = (byProject[row.projectId] ?? 0n) + BigInt(row.amount);
    return Object.fromEntries(Object.entries(byProject).map(([id, sum]) => [id, sum.toString()]));
  }

  const balance = async (engagementId: string) =>
    (await world.prepayments.balance(await studio(), { engagementId })).data[0]?.balance ?? "0";

  const planLines = async (engagementId: string) =>
    (await world.changeOrders.plan(await acmeMember(), { engagementId })).lines.map((l) => [
      l.projectId,
      l.amount,
      l.effectiveFrom,
    ]);

  const statusOf = async (engagementId: string, id: string) =>
    (await world.changeOrders.list(await acme(), { engagementId })).data.find((c) => c.id === id)
      ?.status;

  let proposalCounter = 100;
  async function bill(amount: string, status: DaoProposalStatus = "InProgress") {
    proposalCounter += 1;
    const proposalId = String(proposalCounter);
    statuses[proposalId] = status;
    await database.db.insert(billings).values({
      id: crypto.randomUUID(),
      projectId: "p1",
      nearAccount: "dev.near",
      tokenId: "near",
      amount,
      proposalId,
    });
    return proposalId;
  }

  describe("deciding", () => {
    test("only owners and admins of the side that did not propose can decide; Client members only read", async () => {
      const id = await engagement();
      const proposed = await propose(await studio(), id, [plan("p1", "300")]);

      expect(proposed).toMatchObject({
        status: "proposed",
        proposedBy: { side: "agency", organizationId: "studio" },
        canWithdraw: true,
        canDecide: false,
      });
      for (const scope of [await studio(), await acmeMember()]) {
        await forbidden(world.changeOrders.approve(scope, { id: proposed.id }));
      }
      await refused(
        world.changeOrders.reject(await world.manager("rival-admin", "rival"), { id: proposed.id }),
        "NOT_FOUND",
      );
      const listed = async (scope: Awaited<ReturnType<typeof acme>>) =>
        (await world.changeOrders.list(scope, { engagementId: id })).data;
      expect(await listed(await acme())).toEqual([
        expect.objectContaining({ id: proposed.id, canDecide: true }),
      ]);
      expect(await listed(await acmeMember())).toEqual([
        expect.objectContaining({ canDecide: false, canWithdraw: false }),
      ]);
      await forbidden(propose(await acmeMember(), id, [plan("p2", "1")]));

      const rejected = await world.changeOrders.reject(await acme(), { id: proposed.id });
      expect(rejected).toMatchObject({ status: "rejected", decidedByUserId: "acme-owner" });
      await refused(world.changeOrders.approve(await acme(), { id: proposed.id }), "NOT_PROPOSED");
      expect(await planLines(id)).toEqual([]);
      expect(await inbox("acme-owner")).toContain("change_order_proposed");
      expect(await inbox("studio-admin")).toContain("change_order_rejected");
    });

    test("a Client's Change order is decided by the Agency, and only the Client can withdraw it", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const decided = await propose(await acme(), id, [move("p1", "400")], "now");
      const withdrawnLater = await propose(await acme(), id, [plan("p2", "300")]);

      await forbidden(world.changeOrders.approve(await acme(), { id: decided.id }));
      expect((await world.changeOrders.approve(await studio(), { id: decided.id })).status).toBe(
        "applied",
      );
      await forbidden(world.changeOrders.withdraw(await studio(), { id: withdrawnLater.id }));
      const withdrawn = await world.changeOrders.withdraw(await acme(), { id: withdrawnLater.id });

      expect(withdrawn.status).toBe("withdrawn");
      await refused(
        world.changeOrders.withdraw(await acme(), { id: withdrawnLater.id }),
        "NOT_PROPOSED",
      );
      expect(await inbox("acme-owner")).toContain("change_order_approved");
      expect(await inbox("studio-admin")).toEqual(
        expect.arrayContaining(["change_order_proposed", "change_order_withdrawn"]),
      );
    });

    test("lists the Change orders awaiting the viewer's side", async () => {
      const id = await engagement();
      const proposed = await propose(await studio(), id, [plan("p1", "300")]);
      await propose(await acme(), id, [plan("p2", "100")]);

      expect((await world.changeOrders.awaiting(await acme())).data.map((c) => c.id)).toEqual([
        proposed.id,
      ]);
      expect((await world.changeOrders.awaiting(await studio())).data).toHaveLength(1);
      await world.changeOrders.approve(await acme(), { id: proposed.id });
      expect((await world.changeOrders.awaiting(await acme())).data).toEqual([]);
    });

    test.each([
      ["PLAN_NEEDS_PROJECT", [plan(null, "1")]],
      ["NOT_SHARED", [plan("internal", "100")]],
      ["INVALID_AMOUNT", [plan("p1", "0")]],
      ["UNBALANCED", [move("p1", "100"), move(null, "-50")]],
      ["NO_ITEMS", []],
    ])("refuses %s", async (reason, items) => {
      const id = await engagement();
      await refused(propose(await studio(), id, items), reason);
    });
  });

  describe("the Allocation plan", () => {
    test("the first plan is a Change order by the Agency, applied from the next period once per period", async () => {
      const id = await engagement();
      const approved = await agreed(id, [plan("p1", "300"), plan("p2", "200")]);

      expect(approved).toMatchObject({ status: "applied", effectivePeriod: "2026-10" });
      expect(await planLines(id)).toEqual([
        ["p1", "300", "2026-10"],
        ["p2", "200", "2026-10"],
      ]);

      await record(id, "1000", "2026-09");
      expect(await attributed(id)).toEqual({});

      await record(id, "1000", "2026-10");
      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ p1: "300", p2: "200" });
      expect(await balance(id)).toBe("2500");
      expect((await world.changeOrders.plan(await studio(), { engagementId: id })).nextPeriod).toBe(
        "2026-11",
      );
    });

    test("plan changes take effect from the next period's Prepayment, even when effective now", async () => {
      const id = await engagement();
      await agreed(id, [plan("p1", "300")]);
      today = new Date("2026-10-03T09:00:00Z");
      await record(id, "5000", "2026-10");

      const changed = await agreed(id, [plan("p1", "100"), plan("p2", "50")], "now");

      expect(changed.effectivePeriod).toBe("2026-11");
      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ p1: "300" });
      await record(id, "1000", "2026-11");
      expect(await attributed(id)).toEqual({ p1: "700", p2: "50" });
      expect(await planLines(id)).toEqual([
        ["p1", "400", "2026-11"],
        ["p2", "50", "2026-11"],
      ]);
    });

    test("a late Prepayment for an earlier period uses the plan that was current then", async () => {
      const id = await engagement();
      await agreed(id, [plan("p1", "300")]);
      today = new Date("2026-11-05T09:00:00Z");
      await record(id, "5000", "2026-11");
      await agreed(id, [plan("p1", "-300"), plan("p2", "100")]);

      await record(id, "1000", "2026-10");
      expect(await attributed(id)).toEqual({ p1: "600" });
      await record(id, "1000", "2026-12");
      expect(await attributed(id)).toEqual({ p1: "600", p2: "100" });
    });

    test("skips plan lines that no longer fit the Prepaid balance and notifies both sides", async () => {
      const id = await engagement();
      await agreed(id, [plan("p1", "600"), plan("p2", "600")]);

      await record(id, "1000", "2026-10");

      expect(await attributed(id)).toEqual({ p1: "600" });
      const { applications } = await world.changeOrders.plan(await studio(), { engagementId: id });
      expect(applications).toEqual([
        expect.objectContaining({
          period: "2026-10",
          shortfall: [
            { projectId: "p2", tokenId: "near", amount: "600", reason: "PREPAID_BALANCE_EXCEEDED" },
          ],
        }),
      ]);
      expect(await inbox("acme-owner")).toContain("plan_shortfall");
      expect(await inbox("studio-admin")).toContain("plan_shortfall");

      await record(id, "5000", "2026-10");
      expect(await attributed(id)).toEqual({ p1: "600" });
    });

    test("a plan line cannot go below zero", async () => {
      const id = await engagement();
      await agreed(id, [plan("p1", "300")]);

      const failed = await agreed(id, [plan("p1", "-400")]);

      expect(failed).toMatchObject({ status: "failed", failureReason: "PLAN_BELOW_ZERO" });
      expect(await planLines(id)).toEqual([["p1", "300", "2026-10"]]);
    });
  });

  describe("one-off moves", () => {
    test("apply on approval when effective now, moving Prepaid balance into the Project", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");

      const applied = await agreed(id, [move("p1", "400")], "now");

      expect(applied.status).toBe("applied");
      expect(applied.items).toEqual([move("p1", "400"), move(null, "-400")]);
      expect(await attributed(id)).toEqual({ p1: "400" });
      expect(await balance(id)).toBe("600");
    });

    test("wait for the next period's Prepayment when effective next period", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");

      const approved = await agreed(id, [move("p1", "400"), plan("p2", "100")]);

      expect(approved).toMatchObject({ status: "approved", effectivePeriod: "2026-10" });
      expect(await attributed(id)).toEqual({});
      expect(await planLines(id)).toEqual([]);

      await record(id, "500", "2026-10");

      expect(await statusOf(id, approved.id)).toBe("applied");
      expect(await attributed(id)).toEqual({ p1: "400", p2: "100" });
      expect(await balance(id)).toBe("1000");
    });

    test("move unspent budget between Projects", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("p1", "600")], "now");

      const moved = await agreed(id, [move("p1", "-250"), move("p2", "250")], "now");

      expect(moved.items).toEqual([move("p1", "-250"), move("p2", "250")]);
      expect(await attributed(id)).toEqual({ p1: "350", p2: "250" });
      expect(await balance(id)).toBe("400");
    });
  });

  describe("limits at apply time", () => {
    async function coFunded(acmeAmount: string) {
      const acmeId = await engagement("acme");
      const globexId = await engagement("globex");
      await record(acmeId, "1000", "2026-09");
      await record(globexId, "1000", "2026-09");
      await agreed(acmeId, [move("p1", acmeAmount)], "now");
      const globexMove = await propose(await studio(), globexId, [move("p1", "500")], "now");
      await world.changeOrders.approve(await globex(), { id: globexMove.id });
      return { acmeId, globexId };
    }

    test("two approvals that together exceed the Prepaid balance leave one applied and one failed", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const first = await propose(await acme(), id, [move("p1", "700")], "now");
      const second = await propose(await acme(), id, [move("p2", "700")], "now");

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

    test("a pull-back cannot exceed the Engagement's attributed budget on a co-funded Project", async () => {
      const { acmeId, globexId } = await coFunded("300");

      const tooMuch = await agreed(acmeId, [move("p1", "-400")], "now");
      expect(tooMuch).toMatchObject({
        status: "failed",
        failureReason: "ATTRIBUTED_BUDGET_EXCEEDED",
      });

      const pulled = await agreed(acmeId, [move("p1", "-300")], "now");
      expect(pulled.items).toEqual([move("p1", "-300"), move(null, "300")]);
      expect(await balance(acmeId)).toBe("1000");
      expect(await attributed(globexId)).toEqual({ p1: "500" });
    });

    test("a pull-back cannot take a Project below what is Committed or Paid, rechecked at approval", async () => {
      const { acmeId } = await coFunded("500");
      const pullBack = await propose(await acme(), acmeId, [move("p1", "-300")], "now");

      await bill("600", "Approved");
      await bill("200");

      const failed = await world.changeOrders.approve(await studio(), { id: pullBack.id });
      expect(failed).toMatchObject({ status: "failed", failureReason: "REMAINING_EXCEEDED" });
      expect(await attributed(acmeId)).toEqual({ p1: "500" });

      const fits = await agreed(acmeId, [move("p1", "-200")], "now");
      expect(fits.status).toBe("applied");
      expect(await attributed(acmeId)).toEqual({ p1: "300" });
    });

    test("budget rows are checked in the same order whatever the order of the items", async () => {
      const id = await engagement();
      const entry = (tokenId: string) => ({ projectId: "p1", tokenId, amount: "-1", note: null });

      await expect(
        writeEngagementEntries(database.db, {
          engagementId: id,
          actorAccountId: "admin.near",
          entries: [entry("near"), entry("aurora")],
          statuses: new Map(),
        }),
      ).rejects.toThrow(/less aurora budget/);
    });
  });

  describe("chain statuses", () => {
    test("are fetched before the Engagement is locked, on approval and on plan application", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("p1", "600")], "now");
      await bill("200", "Approved");

      const now = await agreed(id, [move("p1", "-100")], "now");
      const later = await agreed(id, [move("p1", "-100")]);
      await record(id, "1", "2026-10");

      expect(now.status).toBe("applied");
      expect(await statusOf(id, later.id)).toBe("applied");
      expect(fetches.length).toBeGreaterThanOrEqual(2);
      expect(fetches.filter((f) => f.insideLock)).toEqual([]);
    });

    test("a billing created after the statuses were fetched counts as committed", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      await agreed(id, [move("p1", "600")], "now");
      const first = await bill("100");
      const pullBack = await propose(await acme(), id, [move("p1", "-400")], "now");
      onFetch = async () => {
        onFetch = async () => {};
        await bill("300", "Approved");
      };

      const failed = await world.changeOrders.approve(await studio(), { id: pullBack.id });

      expect(failed).toMatchObject({ status: "failed", failureReason: "REMAINING_EXCEEDED" });
      expect(fetches.map((f) => f.proposalId)).toEqual([first]);
    });
  });

  describe("lifecycle", () => {
    test("ending an Engagement withdraws its pending Change orders", async () => {
      const id = await engagement();
      await record(id, "1000", "2026-09");
      const proposed = await propose(await acme(), id, [plan("p1", "100")]);
      const waiting = await agreed(id, [move("p1", "100")]);
      const done = await agreed(id, [plan("p2", "100")]);

      await world.engagements.end(await acme(), id);

      expect(await statusOf(id, proposed.id)).toBe("withdrawn");
      expect(await statusOf(id, waiting.id)).toBe("withdrawn");
      expect(await statusOf(id, done.id)).toBe("applied");
      await refused(propose(await studio(), id, [plan("p1", "1")]), "NOT_ACTIVE");
    });

    test("a Project in the plan cannot be unshared until a Change order removes it", async () => {
      const id = await engagement();
      await agreed(id, [plan("p1", "300")]);

      await refused(
        world.engagements.unshare(await studio(), { engagementId: id, projectId: "p1" }),
        "PLAN_LINES",
      );

      await agreed(id, [plan("p1", "-300")]);
      const after = await world.engagements.unshare(await studio(), {
        engagementId: id,
        projectId: "p1",
      });
      expect(after.projectIds).toEqual(["p2"]);
    });
  });
});
