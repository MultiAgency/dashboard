import { Effect } from "every-plugin/effect";
import { beforeEach, describe, expect, test } from "vitest";
import { budgets } from "../../src/db/schema";
import {
  createBudget,
  createBudgetsService,
  writeEngagementEntries,
} from "../../src/services/budgets";
import { type OrganizationScope, requireTreasury } from "../../src/services/organization-access";
import { engagementWorld, ORIGIN, refused, STUDIO_SEED } from "../fakes/engagements";
import { migratedDatabase } from "./_pg";

const STUDIO_DAO = "studio.sputnik-dao.testnet";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

describe("prepayments", () => {
  const database = migratedDatabase({ perTest: true });
  let world: Awaited<ReturnType<typeof engagementWorld>>;

  beforeEach(async () => {
    world = await engagementWorld(database.db, {
      ...STUDIO_SEED,
      organizations: STUDIO_SEED.organizations.map((o) =>
        o.id === "rival" ? { ...o, daoAccountId: "rival.sputnik-dao.testnet" } : o,
      ),
    });
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acmeOwner = () => world.manager("acme-owner", "acme");
  const acmeMember = () => world.member("acme-member", "acme");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);
  const engagement = async (projectIds: string[] = []) =>
    (await world.activeEngagement("acme", projectIds)).id;
  const record = async (engagementId: string, amount: string, period: string, tokenId = "near") =>
    world.prepayments.record(await studio(), { engagementId, tokenId, amount, period });
  const correct = async (id: string, change: { amount?: string; tokenId?: string }) =>
    world.prepayments.correct(await studio(), { id, ...change });
  const remove = async (id: string) => world.prepayments.remove(await studio(), { id });
  const entries = (engagementId: string, legs: [string, string][]) =>
    writeEngagementEntries(database.db, {
      engagementId,
      actorAccountId: "admin.near",
      entries: legs.map(([projectId, amount]) => ({
        projectId,
        tokenId: "near",
        amount,
        note: null,
      })),
    });
  const spend = (engagementId: string, projectId: string, amount: string) =>
    entries(engagementId, [[projectId, amount]]);
  const balance = async (engagementId: string, scope?: OrganizationScope) =>
    (await world.prepayments.balance(scope ?? (await studio()), { engagementId })).data;
  const nearBalance = async (engagementId: string) => (await balance(engagementId))[0]?.balance;

  describe("recording", () => {
    test("records several Prepayments in a month and shows the Prepaid balance per token", async () => {
      const id = await engagement();

      await record(id, "700", "2026-09");
      await record(id, "300", "2026-09");
      await world.prepayments.record(await studio(), {
        engagementId: id,
        tokenId: USDC,
        amount: "5000000",
        period: "2026-09",
        transferReference: " https://nearblocks.io/txns/abc ",
      });

      expect(await balance(id)).toEqual([
        { tokenId: USDC, prepaid: "5000000", budgeted: "0", balance: "5000000" },
        { tokenId: "near", prepaid: "1000", budgeted: "0", balance: "1000" },
      ]);
      const listed = (await world.prepayments.list(await studio(), { engagementId: id })).data;
      expect(listed).toHaveLength(3);
      expect(listed.find((p) => p.tokenId === USDC)).toMatchObject({
        daoAccountId: STUDIO_DAO,
        period: "2026-09",
        transferReference: "https://nearblocks.io/txns/abc",
      });
    });

    test("refuses an Agency without an Agency DAO", async () => {
      const globex = await world.manager("globex-owner", "globex");
      const proposed = await world.engagements.propose(globex, { slug: "acme", name: "Acme Corp" });
      await world.engagements.accept(await acmeOwner(), proposed.id);

      await expect(
        world.prepayments.record(globex, {
          engagementId: proposed.id,
          tokenId: "near",
          amount: "100",
          period: "2026-09",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", data: { reason: "NO_AGENCY_DAO" } });
    });

    test.each([
      ["100", "2026-13", "INVALID_PERIOD"],
      ["100", "2026-09-01", "INVALID_PERIOD"],
      ["0", "2026-09", "INVALID_AMOUNT"],
    ])("refuses amount %s for period %s", async (amount, period, reason) => {
      await refused(record(await engagement(), amount, period), reason);
    });

    test("notifies the Client's owners and admins when a Prepayment is recorded, corrected or removed", async () => {
      const id = await engagement();
      world.emails.length = 0;

      const recorded = await record(id, "2000000000000000000000000", "2026-09");
      await correct(recorded.id, { amount: "3000000000000000000000000" });
      await remove(recorded.id);

      expect(await inbox("acme-owner")).toEqual([
        "prepayment_removed",
        "prepayment_corrected",
        "prepayment_recorded",
        "engagement_proposed",
      ]);
      expect(await inbox("acme-member")).toEqual([]);
      expect(world.emails.map((e) => [e.to, e.subject])).toEqual([
        ["owner@acme.example", "Studio recorded a Prepayment"],
        ["owner@acme.example", "Studio corrected a Prepayment"],
        ["owner@acme.example", "Studio removed a Prepayment"],
      ]);
      expect(world.emails[0]?.html).toContain("2 NEAR for 2026-09");
      expect(world.emails[0]?.html).toContain(`${ORIGIN}/client/${id}/prepayments`);
    });
  });

  test("the Prepaid balance subtracts attributed Budget entries across periods, not the Agency's own", async () => {
    const id = await engagement(["p1", "p2"]);
    await record(id, "1000", "2026-08");
    await spend(id, "p1", "600");
    await record(id, "1000", "2026-09");
    await spend(id, "p2", "900");
    await createBudget(database.db, {
      projectId: "p1",
      tokenId: "near",
      amount: "5000",
      note: null,
      actorAccountId: "admin.near",
      fundingDaoAccountId: STUDIO_DAO,
    });

    expect(await balance(id)).toEqual([
      { tokenId: "near", prepaid: "2000", budgeted: "1500", balance: "500" },
    ]);
  });

  describe("correcting and removing", () => {
    test("corrects the amount, token, period and transfer reference", async () => {
      const id = await engagement();
      const recorded = await record(id, "1000", "2026-09");

      const corrected = await world.prepayments.correct(await studio(), {
        id: recorded.id,
        tokenId: USDC,
        amount: "250",
        period: "2026-10",
        transferReference: "tx-123",
      });

      expect(corrected).toMatchObject({
        tokenId: USDC,
        amount: "250",
        period: "2026-10",
        transferReference: "tx-123",
      });
      expect(await balance(id)).toEqual([
        { tokenId: USDC, prepaid: "250", budgeted: "0", balance: "250" },
      ]);
    });

    test("refuses a correction or removal that takes the Prepaid balance below zero", async () => {
      const id = await engagement(["p1"]);
      const first = await record(id, "1000", "2026-08");
      const second = await record(id, "500", "2026-09");
      await spend(id, "p1", "1200");

      await refused(correct(first.id, { amount: "600" }), "PREPAID_BALANCE_NEGATIVE");
      await refused(correct(second.id, { tokenId: USDC }), "PREPAID_BALANCE_NEGATIVE");
      await refused(remove(second.id), "PREPAID_BALANCE_NEGATIVE");

      await correct(first.id, { amount: "700" });
      expect(await balance(id)).toEqual([
        { tokenId: "near", prepaid: "1200", budgeted: "1200", balance: "0" },
      ]);
    });

    test("allows a correction that raises an already negative Prepaid balance", async () => {
      const id = await engagement(["p1"]);
      const recorded = await record(id, "1000", "2026-09");
      await database.db.insert(budgets).values({
        id: "legacy",
        projectId: "p1",
        tokenId: "near",
        amount: "1500",
        actorAccountId: "admin.near",
        engagementId: id,
      });

      await correct(recorded.id, { amount: "1200" });
      expect(await nearBalance(id)).toBe("-300");

      await refused(correct(recorded.id, { amount: "1100" }), "PREPAID_BALANCE_NEGATIVE");
      await refused(remove(recorded.id), "PREPAID_BALANCE_NEGATIVE");
      expect(await nearBalance(id)).toBe("-300");
    });

    test("never reverses Budget entries already applied", async () => {
      const id = await engagement(["p1"]);
      const recorded = await record(id, "1000", "2026-09");
      await record(id, "1000", "2026-09");
      await spend(id, "p1", "800");

      await remove(recorded.id);

      const listed = await Effect.runPromise(
        createBudgetsService(database.db, world.directory).list(requireTreasury(await studio()), {
          engagementId: id,
          limit: 50,
        }),
      );
      expect(listed.data.map((e) => e.amount)).toEqual(["800"]);
      expect(await nearBalance(id)).toBe("200");
    });
  });

  describe("access", () => {
    test("Client members read Prepayments and the balance but cannot change them", async () => {
      const id = await engagement();
      const recorded = await record(id, "1000", "2026-09");

      for (const scope of [await acmeMember(), await acmeOwner()]) {
        expect((await world.prepayments.list(scope, { engagementId: id })).data).toEqual([
          expect.objectContaining({ id: recorded.id, amount: "1000" }),
        ]);
        expect(await balance(id, scope)).toEqual([
          { tokenId: "near", prepaid: "1000", budgeted: "0", balance: "1000" },
        ]);
      }
      const owner = await acmeOwner();
      const input = { engagementId: id, tokenId: "near", amount: "1", period: "2026-09" };
      for (const attempt of [
        () => world.prepayments.record(owner, input),
        () => world.prepayments.correct(owner, { id: recorded.id, amount: "1" }),
        () => world.prepayments.remove(owner, { id: recorded.id }),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
        });
      }
    });

    test("other Organizations see nothing", async () => {
      const id = await engagement();
      const recorded = await record(id, "1000", "2026-09");
      const rival = await world.manager("rival-admin", "rival");

      await refused(world.prepayments.list(rival, { engagementId: id }), "NOT_FOUND");
      await refused(world.prepayments.balance(rival, { engagementId: id }), "NOT_FOUND");
      await refused(world.prepayments.remove(rival, { id: recorded.id }), "NOT_FOUND");
    });

    test("an ended Engagement's Prepayments are read-only history and take no Budget entries", async () => {
      const id = await engagement(["p1"]);
      const recorded = await record(id, "1000", "2026-09");
      await world.engagements.end(await acmeOwner(), id);

      await refused(record(id, "1", "2026-10"), "NOT_ACTIVE");
      await refused(correct(recorded.id, { amount: "2" }), "NOT_ACTIVE");
      await refused(remove(recorded.id), "NOT_ACTIVE");
      await expect(spend(id, "p1", "1")).rejects.toMatchObject({ reason: "NOT_ACTIVE" });
      expect(
        (await world.prepayments.list(await acmeMember(), { engagementId: id })).data,
      ).toHaveLength(1);
      expect((await balance(id, await acmeMember()))[0]?.balance).toBe("1000");
    });
  });

  describe("Engagement-attributed Budget entries", () => {
    test("are funded from the Agency DAO, keep their attribution when moved, and stay within the Prepaid balance", async () => {
      const id = await engagement(["p1", "p2"]);
      await record(id, "1000", "2026-09");

      const [entry] = await spend(id, "p1", "400");
      const moved = await entries(id, [
        ["p1", "-250"],
        ["p2", "250"],
      ]);

      for (const row of [entry, ...moved]) {
        expect(row).toMatchObject({ engagementId: id, fundingDaoAccountId: STUDIO_DAO });
      }
      expect(await nearBalance(id)).toBe("600");
      await expect(spend(id, "p2", "601")).rejects.toMatchObject({
        reason: "PREPAID_BALANCE_EXCEEDED",
      });
      await expect(spend(id, "p1", "-151")).rejects.toMatchObject({
        reason: "ATTRIBUTED_BUDGET_EXCEEDED",
      });
      await expect(spend(id, "internal", "1")).rejects.toMatchObject({ reason: "NOT_SHARED" });
    });

    test("plain Budgets routes move only the Agency's own budget", async () => {
      const id = await engagement(["p1"]);
      await record(id, "1000", "2026-09");
      await spend(id, "p1", "600");
      const service = createBudgetsService(database.db, world.directory);
      const scope = requireTreasury(await studio());
      const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
      const failure = <A>(effect: Effect.Effect<A, unknown>) =>
        Effect.runPromise(Effect.flip(effect));
      const move = { fromProjectId: "p1", toProjectId: "internal", tokenId: "near" };
      await run(service.create(scope, { projectId: "p1", tokenId: "near", amount: "100" }));

      expect(
        await failure(
          service.deallocate(scope, { projectId: "p1", tokenId: "near", amount: "101" }),
        ),
      ).toMatchObject({ code: "BAD_REQUEST", data: { reason: "ENGAGEMENT_ATTRIBUTED" } });
      expect(await failure(service.transfer(scope, { ...move, amount: "101" }))).toMatchObject({
        data: { reason: "ENGAGEMENT_ATTRIBUTED" },
      });

      const { from, to } = await run(service.transfer(scope, { ...move, amount: "100" }));
      for (const leg of [from, to]) {
        expect(leg).toMatchObject({ engagementId: null, fundingDaoAccountId: STUDIO_DAO });
      }
      expect(await nearBalance(id)).toBe("400");
    });
  });
});
