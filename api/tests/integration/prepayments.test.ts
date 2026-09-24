import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import {
  createBudget,
  createBudgetsService,
  transferEngagementBudget,
  writeEngagementEntries,
} from "../../src/services/budgets";
import { requireTreasury } from "../../src/services/organization-access";
import { engagementWorld, ORIGIN } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const STUDIO_DAO = "studio.sputnik-dao.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
  { id: "nodao", name: "No Dao", slug: "nodao" },
  { id: "rival", name: "Rival", slug: "rival", daoAccountId: "rival.sputnik-dao.near" },
  { id: "acme", name: "Acme Corp", slug: "acme" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-member", organizationId: "studio", role: "member" as const },
  { userId: "nodao-owner", organizationId: "nodao", role: "owner" as const },
  { userId: "rival-owner", organizationId: "rival", role: "owner" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
];

const users = [
  { id: "studio-admin", email: "admin@studio.example" },
  { id: "studio-member", email: "member@studio.example" },
  { id: "nodao-owner", email: "owner@nodao.example" },
  { id: "rival-owner", email: "owner@rival.example" },
  { id: "acme-owner", email: "owner@acme.example" },
  { id: "acme-member", email: "member@acme.example" },
];

const projects = [project("site", "studio"), project("app", "studio"), project("own", "studio")];

describe("prepayments", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects });
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const acmeOwner = () => world.manager("acme-owner", "acme");
  const acmeMember = () => world.member("acme-member", "acme");
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  async function engagement(agency = "studio", admin = "studio-admin") {
    const proposed = await world.engagements.propose(await world.manager(admin, agency), {
      slug: "acme",
      name: "Acme Corp",
    });
    await world.engagements.accept(await acmeOwner(), proposed.id);
    return proposed.id;
  }

  async function sharedEngagement() {
    const id = await engagement();
    for (const projectId of ["site", "app"]) {
      await world.engagements.share(await studio(), { engagementId: id, projectId });
    }
    return id;
  }

  const record = async (engagementId: string, amount: string, period: string, tokenId = "near") =>
    world.prepayments.record(await studio(), { engagementId, tokenId, amount, period });

  const spend = (engagementId: string, projectId: string, amount: string, tokenId = "near") =>
    writeEngagementEntries(db, {
      engagementId,
      actorAccountId: "admin.near",
      entries: [{ projectId, tokenId, amount, note: null }],
    });

  const balance = async (
    engagementId: string,
    scope?: Parameters<typeof world.prepayments.balance>[0],
  ) => (await world.prepayments.balance(scope ?? (await studio()), { engagementId })).data;

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
      const id = await engagement("nodao", "nodao-owner");

      await expect(
        world.prepayments.record(await world.manager("nodao-owner", "nodao"), {
          engagementId: id,
          tokenId: "near",
          amount: "100",
          period: "2026-09",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", data: { reason: "NO_AGENCY_DAO" } });
      expect(await balance(id, await world.member("nodao-owner", "nodao"))).toEqual([]);
    });

    test("refuses periods that are not calendar months and amounts that are not positive", async () => {
      const id = await engagement();

      await expect(record(id, "100", "2026-13")).rejects.toMatchObject({
        data: { reason: "INVALID_PERIOD" },
      });
      await expect(record(id, "100", "2026-09-01")).rejects.toMatchObject({
        data: { reason: "INVALID_PERIOD" },
      });
      await expect(record(id, "0", "2026-09")).rejects.toMatchObject({
        data: { reason: "INVALID_AMOUNT" },
      });
    });

    test("notifies the Client's owners and admins when a Prepayment is recorded, corrected or removed", async () => {
      const id = await engagement();
      world.emails.length = 0;

      const recorded = await record(id, "2000000000000000000000000", "2026-09");
      await world.prepayments.correct(await studio(), {
        id: recorded.id,
        amount: "3000000000000000000000000",
      });
      await world.prepayments.remove(await studio(), { id: recorded.id });

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

  describe("the Prepaid balance", () => {
    test("subtracts Budget entries attributed to the Engagement and rolls over across periods", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-08");
      await spend(id, "site", "600");
      await record(id, "1000", "2026-09");
      await spend(id, "app", "900");

      expect(await balance(id)).toEqual([
        { tokenId: "near", prepaid: "2000", budgeted: "1500", balance: "500" },
      ]);
    });

    test("is not touched by the Agency's own Budget entries", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-09");

      await createBudget(db, {
        projectId: "site",
        tokenId: "near",
        amount: "5000",
        note: null,
        actorAccountId: "admin.near",
        fundingDaoAccountId: STUDIO_DAO,
      });

      expect((await balance(id))[0]?.balance).toBe("1000");
    });
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
      const id = await sharedEngagement();
      const first = await record(id, "1000", "2026-08");
      const second = await record(id, "500", "2026-09");
      await spend(id, "site", "1200");

      await expect(
        world.prepayments.correct(await studio(), { id: first.id, amount: "600" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        data: { reason: "PREPAID_BALANCE_NEGATIVE" },
      });
      await expect(
        world.prepayments.correct(await studio(), { id: second.id, tokenId: USDC }),
      ).rejects.toMatchObject({ data: { reason: "PREPAID_BALANCE_NEGATIVE" } });
      await expect(
        world.prepayments.remove(await studio(), { id: second.id }),
      ).rejects.toMatchObject({ data: { reason: "PREPAID_BALANCE_NEGATIVE" } });

      await world.prepayments.correct(await studio(), { id: first.id, amount: "700" });
      expect(await balance(id)).toEqual([
        { tokenId: "near", prepaid: "1200", budgeted: "1200", balance: "0" },
      ]);
    });

    test("never reverses Budget entries already applied", async () => {
      const id = await sharedEngagement();
      const recorded = await record(id, "1000", "2026-09");
      await record(id, "1000", "2026-09");
      await spend(id, "site", "800");

      await world.prepayments.remove(await studio(), { id: recorded.id });

      const entries = await Effect.runPromise(
        createBudgetsService(db, world.directory).list(requireTreasury(await studio()), {
          engagementId: id,
          limit: 50,
        }),
      );
      expect(entries.data.map((e) => e.amount)).toEqual(["800"]);
      expect((await balance(id))[0]?.balance).toBe("200");
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
      await expect(
        world.prepayments.record(owner, {
          engagementId: id,
          tokenId: "near",
          amount: "1",
          period: "2026-09",
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
      await expect(
        world.prepayments.correct(owner, { id: recorded.id, amount: "1" }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
      await expect(world.prepayments.remove(owner, { id: recorded.id })).rejects.toMatchObject({
        code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
      });
    });

    test("other Organizations see nothing", async () => {
      const id = await engagement();
      const recorded = await record(id, "1000", "2026-09");
      const rival = await world.manager("rival-owner", "rival");

      await expect(world.prepayments.list(rival, { engagementId: id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(world.prepayments.balance(rival, { engagementId: id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(world.prepayments.remove(rival, { id: recorded.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("an ended Engagement's Prepayments are read-only history", async () => {
      const id = await engagement();
      const recorded = await record(id, "1000", "2026-09");
      await world.engagements.end(await acmeOwner(), id);

      await expect(record(id, "1", "2026-10")).rejects.toMatchObject({
        data: { reason: "NOT_ACTIVE" },
      });
      await expect(
        world.prepayments.correct(await studio(), { id: recorded.id, amount: "2" }),
      ).rejects.toMatchObject({ data: { reason: "NOT_ACTIVE" } });
      await expect(
        world.prepayments.remove(await studio(), { id: recorded.id }),
      ).rejects.toMatchObject({ data: { reason: "NOT_ACTIVE" } });
      expect(
        (await world.prepayments.list(await acmeMember(), { engagementId: id })).data,
      ).toHaveLength(1);
      expect((await balance(id, await acmeMember()))[0]?.balance).toBe("1000");
    });
  });

  describe("Engagement-attributed Budget entries", () => {
    test("are funded from the Agency DAO and cannot exceed the Prepaid balance", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-09");

      const [entry] = await spend(id, "site", "400");

      expect(entry).toMatchObject({ engagementId: id, fundingDaoAccountId: STUDIO_DAO });
      await expect(spend(id, "app", "601")).rejects.toMatchObject({
        reason: "PREPAID_BALANCE_EXCEEDED",
      });
      await expect(spend(id, "own", "1")).rejects.toMatchObject({ reason: "NOT_SHARED" });
    });

    test("keep their attribution and funding DAO on both legs of a transfer", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-09");
      await spend(id, "site", "600");

      const { from, to } = await transferEngagementBudget(db, {
        engagementId: id,
        fromProjectId: "site",
        toProjectId: "app",
        tokenId: "near",
        amount: "250",
        note: "rebalance",
        actorAccountId: "admin.near",
      });

      for (const leg of [from, to]) {
        expect(leg).toMatchObject({ engagementId: id, fundingDaoAccountId: STUDIO_DAO });
      }
      expect([from.amount, to.amount]).toEqual(["-250", "250"]);
      expect(from.relatedBudgetId).toBe(to.id);
      expect((await balance(id))[0]?.balance).toBe("400");
      await expect(
        transferEngagementBudget(db, {
          engagementId: id,
          fromProjectId: "site",
          toProjectId: "app",
          tokenId: "near",
          amount: "351",
          note: null,
          actorAccountId: "admin.near",
        }),
      ).rejects.toMatchObject({ reason: "ATTRIBUTED_BUDGET_EXCEEDED" });
    });

    test("plain Budgets routes move only the Agency's own budget", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-09");
      await spend(id, "site", "600");
      const budgets = createBudgetsService(db, world.directory);
      const scope = requireTreasury(await studio());
      const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
      const failure = <A>(effect: Effect.Effect<A, unknown>) =>
        Effect.runPromise(Effect.flip(effect));
      await run(budgets.create(scope, { projectId: "site", tokenId: "near", amount: "100" }));

      expect(
        await failure(
          budgets.deallocate(scope, { projectId: "site", tokenId: "near", amount: "101" }),
        ),
      ).toMatchObject({ code: "BAD_REQUEST", data: { reason: "ENGAGEMENT_ATTRIBUTED" } });
      expect(
        await failure(
          budgets.transfer(scope, {
            fromProjectId: "site",
            toProjectId: "own",
            tokenId: "near",
            amount: "101",
          }),
        ),
      ).toMatchObject({ data: { reason: "ENGAGEMENT_ATTRIBUTED" } });

      const { from, to } = await run(
        budgets.transfer(scope, {
          fromProjectId: "site",
          toProjectId: "own",
          tokenId: "near",
          amount: "100",
        }),
      );
      for (const leg of [from, to]) {
        expect(leg).toMatchObject({ engagementId: null, fundingDaoAccountId: STUDIO_DAO });
      }
      expect((await balance(id))[0]?.balance).toBe("400");
    });

    test("are refused on an ended Engagement", async () => {
      const id = await sharedEngagement();
      await record(id, "1000", "2026-09");
      await world.engagements.end(await studio(), id);

      await expect(spend(id, "site", "1")).rejects.toMatchObject({ reason: "NOT_ACTIVE" });
    });
  });
});
