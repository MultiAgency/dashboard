import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets, proposals } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBillingsService } from "../../src/services/billings";
import { createBudgetsService, writeEngagementEntries } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { requireTreasury } from "../../src/services/organization-access";
import { createReportsService } from "../../src/services/reports";
import type { DaoProposalStatus } from "../../src/services/sputnik";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

let daoCounter = 0;

const organizationsWith = (studioDao: string, crewDao: string) => [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: studioDao },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "crew", name: "Crew", slug: "crew", daoAccountId: crewDao },
  { id: "rival", name: "Rival", slug: "rival" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "crew-owner", organizationId: "crew", role: "owner" as const },
  { userId: "crew-member", organizationId: "crew", role: "member" as const },
  { userId: "rival-admin", organizationId: "rival", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

const projects = [
  { ...project("site", "studio"), slug: "site", title: "Website" },
  { ...project("internal", "studio"), slug: "internal", title: "Internal" },
  { ...project("rival-work", "rival"), slug: "rival-work", title: "Rival work" },
];

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);

describe("subcontracting", () => {
  let pg: PGlite;
  let db: Database;
  let STUDIO_DAO: string;
  let CREW_DAO: string;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let services: ReturnType<typeof buildServices>;
  let acmeEngagement: string;

  function buildServices() {
    const plugins = {
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
      projects: () => ({
        updateProject: async () => {
          throw new Error("the projects plugin must not be reached");
        },
      }),
    } as unknown as PluginsClient;
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    const agency = createAgencyService(db, plugins, world.directory, listings, ledgers);
    const billings = createBillingsService(db, world.directory, world.access);
    const reports = createReportsService(
      db,
      world.directory,
      plugins,
      world.organizations.directory,
    );
    return {
      agency,
      listings,
      billings,
      reports,
      budgets: createBudgetsService(db, world.directory),
      assignments: createAssignmentsService(
        db,
        world.directory,
        world.access,
        world.organizations.directory,
      ),
      portal: createClientPortalService(
        world.access,
        agency,
        billings,
        reports,
        world.directory,
        ledgers,
      ),
    };
  }

  beforeEach(async () => {
    daoCounter += 1;
    STUDIO_DAO = `studio-${daoCounter}.sputnik-dao.testnet`;
    CREW_DAO = `crew-${daoCounter}.sputnik-dao.testnet`;
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, {
      organizations: organizationsWith(STUDIO_DAO, CREW_DAO),
      members,
      users,
      projects,
    });
    services = buildServices();
    const proposed = await world.engagements.propose(await studio(), {
      slug: "acme",
      name: "Acme Corp",
    });
    await world.engagements.accept(await world.manager("acme-owner", "acme"), proposed.id);
    await world.engagements.share(await studio(), { engagementId: proposed.id, projectId: "site" });
    acmeEngagement = proposed.id;
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");
  const crew = () => world.manager("crew-owner", "crew");
  const crewMember = () => world.member("crew-member", "crew");
  const treasury = async (scope: Promise<Awaited<ReturnType<typeof studio>>>) =>
    requireTreasury(await scope);
  const inbox = async (userId: string) =>
    (await world.notifications.list(userId, { limit: 50 })).data.map((n) => n.kind);

  async function subcontract(projectIds = ["site"]) {
    return world.engagements.subcontract(await studio(), {
      slug: "crew",
      name: "Crew",
      projectIds,
    });
  }

  async function transferProposal(
    daoAccountId: string,
    proposalId: number,
    amount: string,
    status: Exclude<DaoProposalStatus, "InProgress"> = "Approved",
  ) {
    await db.insert(proposals).values({
      daoAccountId,
      proposalId,
      proposer: "admin.near",
      description: "payout",
      status,
      kindType: "Transfer",
      transferTokenId: "",
      transferReceiverId: "dev.near",
      transferAmount: amount,
      submissionTime: "1700000000000000000",
    });
  }

  async function bill(scope: ReturnType<typeof studio>, proposalId: number) {
    return run(
      services.billings.create(await treasury(scope), {
        projectId: "site",
        proposalId: String(proposalId),
      }),
    );
  }

  describe("sharing in one step", () => {
    test("the Subcontract is active at once, with no acceptance, and its managers are told", async () => {
      const engagement = await subcontract();

      expect(engagement).toMatchObject({
        kind: "subcontract",
        status: "active",
        side: "agency",
        client: { id: "crew", name: "Crew" },
        projectIds: ["site"],
      });
      expect(await inbox("crew-owner")).toEqual(["subcontract_started"]);
      expect(await inbox("crew-member")).toEqual([]);
      await expect(world.engagements.accept(await crew(), engagement.id)).rejects.toMatchObject({
        data: { reason: "NOT_PROPOSED" },
      });
    });

    test("the Subcontractor finds the work under Shared with us", async () => {
      const engagement = await subcontract();

      const shared = await world.engagements.sharedWithUs(await crewMember());

      expect(shared.data).toEqual([
        expect.objectContaining({
          engagementId: engagement.id,
          readOnly: false,
          agency: { id: "studio", name: "Studio", slug: "studio" },
          project: expect.objectContaining({ id: "site", title: "Website" }),
        }),
      ]);
      expect((await world.engagements.sharedWithUs(await studio())).data).toEqual([]);
      expect(
        (await world.engagements.sharedWithUs(await world.manager("acme-owner", "acme"))).data,
      ).toEqual([]);
    });

    test("only the Agency's own Projects can be subcontracted, and never to itself", async () => {
      await expect(subcontract(["rival-work"])).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.engagements.subcontract(await studio(), { slug: "studio", name: "Studio" }),
      ).rejects.toMatchObject({ data: { reason: "SELF_ENGAGEMENT" } });
      await expect(
        world.engagements.subcontract(await studio(), { slug: "crew", name: "Crew Ltd" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("a new Subcontractor is created with its first admin invited by email", async () => {
      const engagement = await world.engagements.createWithClient(await studio(), {
        name: "New Crew",
        slug: "new-crew",
        adminEmail: "lead@newcrew.example",
        projectIds: ["site"],
        kind: "subcontract",
      });

      expect(engagement).toMatchObject({
        kind: "subcontract",
        status: "active",
        client: { name: "New Crew", slug: "new-crew" },
        invitation: { email: "lead@newcrew.example", status: "pending" },
      });
      expect(world.emails.at(-1)).toMatchObject({ to: "lead@newcrew.example" });
      expect(world.emails.at(-1)?.html).toContain("as its Subcontractor");
    });

    test("the hiring Agency may still record a Prepayment for the Subcontractor", async () => {
      const engagement = await subcontract();

      await world.prepayments.record(await studio(), {
        engagementId: engagement.id,
        tokenId: "near",
        amount: "500",
        period: "2026-09",
      });

      expect(
        (await world.prepayments.list(await crew(), { engagementId: engagement.id })).data,
      ).toEqual([expect.objectContaining({ amount: "500", period: "2026-09" })]);
    });
  });

  describe("what the Subcontractor may do", () => {
    test("assigns its own builders, bills from its own Agency DAO and generates reports", async () => {
      const engagement = await subcontract();
      await transferProposal(CREW_DAO, 1, "300");

      await run(
        services.assignments.create(await crewMember(), {
          projectId: "site",
          nearAccount: "dev.near",
        }),
      );
      const created = await bill(crew(), 1);
      const report = await run(
        services.portal.generateReport(world.context("crew-owner", "crew"), {
          engagementId: engagement.id,
        }),
      );

      expect(created.billing).toMatchObject({
        projectId: "site",
        payingDaoAccountId: CREW_DAO,
        amount: "300",
        status: "Approved",
      });
      expect(report.overview.billedByToken).toEqual([{ tokenId: "near", amount: "300" }]);
    });

    test("cannot edit the Project, publish Listings or add Budget entries against the owner's DAO", async () => {
      await subcontract();
      const scope = await crew();

      await expect(
        run(services.agency.updateProject(scope, { id: "site", title: "Taken over" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        run(
          services.listings.createInternal(scope, {
            projectId: "site",
            title: "Bounty",
            type: "Bounty",
            token: "near",
            rewardAmount: "1",
            lifecycle: "published",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        run(
          services.budgets.create(requireTreasury(scope), {
            projectId: "site",
            tokenId: "near",
            amount: "1000",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await db.select().from(budgets)).toEqual([]);
    });

    test("cannot work on Projects the Agency did not subcontract", async () => {
      await subcontract();
      await transferProposal(CREW_DAO, 2, "10");

      await expect(
        run(
          services.assignments.create(await crew(), {
            projectId: "internal",
            nearAccount: "dev.near",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        run(
          services.billings.create(requireTreasury(await crew()), {
            projectId: "internal",
            proposalId: "2",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("after the Subcontract ends the shared Project is read-only for the Subcontractor", async () => {
      const engagement = await subcontract();
      await world.engagements.end(await studio(), engagement.id);

      await expect(
        run(
          services.assignments.create(await crew(), { projectId: "site", nearAccount: "dev.near" }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", data: { reason: "ENGAGEMENT_ENDED" } });
      expect((await world.engagements.sharedWithUs(await crew())).data).toEqual([
        expect.objectContaining({ engagementId: engagement.id, readOnly: true }),
      ]);
    });
  });

  describe("assignments", () => {
    test("record who assigned them; both sides see all and remove only their own", async () => {
      await subcontract();
      await run(
        services.assignments.create(await studio(), { projectId: "site", nearAccount: "own.near" }),
      );
      await run(
        services.assignments.create(await crew(), {
          projectId: "site",
          nearAccount: "crew-dev.near",
        }),
      );

      for (const scope of [await studio(), await crew()]) {
        const listed = await run(services.assignments.list(scope, "site"));
        expect(
          listed.data.map((a) => [a.nearAccount, a.assignedBy?.name, a.canRemove]).sort(),
        ).toEqual(
          [
            ["crew-dev.near", "Crew", scope.organizationId === "crew"],
            ["own.near", "Studio", scope.organizationId === "studio"],
          ].sort(),
        );
      }

      await expect(
        run(
          services.assignments.delete(await crew(), { projectId: "site", nearAccount: "own.near" }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        run(
          services.assignments.delete(await studio(), {
            projectId: "site",
            nearAccount: "crew-dev.near",
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await run(
        services.assignments.delete(await crew(), {
          projectId: "site",
          nearAccount: "crew-dev.near",
        }),
      );
      await run(
        services.assignments.delete(await studio(), { projectId: "site", nearAccount: "own.near" }),
      );
      expect((await run(services.assignments.list(await studio(), "site"))).data).toEqual([]);
    });

    test("a builder assigned by one side cannot be taken over by the other", async () => {
      await subcontract();
      await run(
        services.assignments.create(await studio(), {
          projectId: "site",
          nearAccount: "dev.near",
          role: "lead",
        }),
      );

      await expect(
        run(
          services.assignments.create(await crew(), {
            projectId: "site",
            nearAccount: "dev.near",
            role: "intern",
          }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "ASSIGNED_BY_OTHER" } });
      expect((await run(services.assignments.list(await crew(), "site"))).data).toEqual([
        expect.objectContaining({ nearAccount: "dev.near", role: "lead" }),
      ]);
    });

    test("the Subcontractor's assignments show under its Assignments with the hiring Agency's Projects", async () => {
      await subcontract();
      await run(
        services.assignments.create(await crew(), {
          projectId: "site",
          nearAccount: "crew-dev.near",
        }),
      );

      const listed = await run(services.assignments.listAll(await crew()));

      expect(listed.data).toEqual([
        expect.objectContaining({
          projectId: "site",
          projectTitle: "Website",
          nearAccount: "crew-dev.near",
        }),
      ]);
    });
  });

  describe("billings", () => {
    test("the same proposal id is a different Billing on another Agency DAO", async () => {
      await subcontract();
      await transferProposal(STUDIO_DAO, 7, "100");
      await transferProposal(CREW_DAO, 7, "300");

      await bill(studio(), 7);
      await bill(crew(), 7);

      await expect(bill(studio(), 7)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(bill(crew(), 7)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const listed = await run(
        services.billings.list(await treasury(studio()), { projectId: "site", limit: 50 }),
      );
      expect(listed.data.map((b) => [b.payingDaoAccountId, b.amount]).sort()).toEqual(
        [
          [CREW_DAO, "300"],
          [STUDIO_DAO, "100"],
        ].sort(),
      );
    });

    test("status comes from the paying Agency DAO, whoever looks", async () => {
      await subcontract();
      await transferProposal(CREW_DAO, 8, "300", "Approved");
      await transferProposal(STUDIO_DAO, 8, "300", "Rejected");
      await bill(crew(), 8);

      const byStudio = await run(
        services.billings.list(await treasury(studio()), { projectId: "site", limit: 50 }),
      );
      const byClient = await run(
        services.portal.listBillings(world.context("acme-owner", "acme"), {
          engagementId: acmeEngagement,
          limit: 50,
        }),
      );

      expect(byStudio.data).toEqual([
        expect.objectContaining({ payingDaoAccountId: CREW_DAO, status: "Approved" }),
      ]);
      expect(byClient.data).toEqual([
        expect.objectContaining({ payingDaoAccountId: CREW_DAO, status: "Approved" }),
      ]);
    });

    test("each side deletes only the Billings its own Agency DAO paid", async () => {
      await subcontract();
      await transferProposal(STUDIO_DAO, 9, "100");
      await transferProposal(CREW_DAO, 10, "300");
      const own = await bill(studio(), 9);
      const theirs = await bill(crew(), 10);

      await expect(
        run(services.billings.delete(await treasury(studio()), { id: theirs.billing.id })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        run(services.billings.delete(await treasury(crew()), { id: own.billing.id })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await run(services.billings.delete(await treasury(crew()), { id: theirs.billing.id }));
      await run(services.billings.delete(await treasury(studio()), { id: own.billing.id }));
    });
  });

  describe("rollups by funding and paying DAO", () => {
    beforeEach(async () => {
      await subcontract();
      await db.insert(budgets).values({
        id: "acme-budget",
        projectId: "site",
        tokenId: "near",
        amount: "1000",
        actorAccountId: "admin.near",
        engagementId: acmeEngagement,
        fundingDaoAccountId: STUDIO_DAO,
      });
      await transferProposal(STUDIO_DAO, 20, "100");
      await transferProposal(CREW_DAO, 21, "300");
      await bill(studio(), 20);
      await bill(crew(), 21);
    });

    test("the hiring Agency sees its own remaining without the Subcontractor's pay, and that pay apart", async () => {
      const rollup = await run(services.agency.getBudget(await treasury(studio()), "site"));

      expect(rollup).toEqual({
        budgets: [
          {
            tokenId: "near",
            budget: "1000",
            allocated: "0",
            committed: "0",
            paid: "100",
            remaining: "900",
          },
        ],
        subcontractorSpend: [
          { daoAccountId: CREW_DAO, tokenId: "near", committed: "0", paid: "300" },
        ],
      });
    });

    test("the Subcontractor sees only its own pay, never the owner's budget", async () => {
      const engagement = (await world.engagements.list(await crew())).data[0]!;

      const rollup = await run(
        services.portal.getBudget(world.context("crew-owner", "crew"), {
          engagementId: engagement.id,
          projectId: "site",
        }),
      );
      const summary = await run(
        services.portal.dashboardSummary(world.context("crew-owner", "crew"), {
          engagementId: engagement.id,
        }),
      );

      expect(rollup).toEqual({
        budgets: [],
        subcontractorSpend: [
          { daoAccountId: CREW_DAO, tokenId: "near", committed: "0", paid: "300" },
        ],
      });
      expect(summary.remainingByToken).toEqual([]);
    });

    test("pulling budget back is limited by the owner's own spend only", async () => {
      await world.prepayments.record(await studio(), {
        engagementId: acmeEngagement,
        tokenId: "near",
        amount: "1000",
        period: "2026-08",
      });
      await writeEngagementEntries(db, {
        engagementId: acmeEngagement,
        actorAccountId: "admin.near",
        entries: [{ projectId: "site", tokenId: "near", amount: "-900", note: null }],
        statuses: new Map(),
      });

      await expect(
        writeEngagementEntries(db, {
          engagementId: acmeEngagement,
          actorAccountId: "admin.near",
          entries: [{ projectId: "site", tokenId: "near", amount: "-1", note: null }],
          statuses: new Map(),
        }),
      ).rejects.toMatchObject({ reason: "REMAINING_EXCEEDED" });
    });
  });

  describe("visibility", () => {
    test("the Subcontractor never reaches the end Client's Engagement", async () => {
      await subcontract();
      const scope = await crew();

      expect((await world.engagements.list(scope)).data.map((e) => e.kind)).toEqual([
        "subcontract",
      ]);
      await expect(world.engagements.get(scope, acmeEngagement)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        world.prepayments.list(scope, { engagementId: acmeEngagement }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.changeOrders.plan(scope, { engagementId: acmeEngagement }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        world.access.sharedWith(world.context("crew-owner", "crew"), acmeEngagement),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("the Subcontractor's report and Billings leave out the owner's budget and pay", async () => {
      const engagement = await subcontract();
      await db.insert(budgets).values({
        id: "acme-budget",
        projectId: "site",
        tokenId: "near",
        amount: "1000",
        actorAccountId: "admin.near",
        engagementId: acmeEngagement,
        fundingDaoAccountId: STUDIO_DAO,
      });
      await transferProposal(STUDIO_DAO, 30, "100");
      await transferProposal(CREW_DAO, 31, "300");
      await bill(studio(), 30);
      await bill(crew(), 31);
      const context = world.context("crew-owner", "crew");

      const report = await run(
        services.portal.generateReport(context, { engagementId: engagement.id }),
      );
      const billed = await run(
        services.portal.listBillings(context, { engagementId: engagement.id, limit: 50 }),
      );
      const own = await run(
        services.billings.list(await treasury(crew()), { projectId: "site", limit: 50 }),
      );

      expect(report.overview.budgetByToken).toEqual([]);
      expect(report.overview.billedByToken).toEqual([{ tokenId: "near", amount: "300" }]);
      expect(report.clientBreakdown.map((row) => row.clientName)).toEqual(["Crew"]);
      expect(billed.data.map((b) => b.payingDaoAccountId)).toEqual([CREW_DAO]);
      expect(own.data.map((b) => b.payingDaoAccountId)).toEqual([CREW_DAO]);
    });

    test("the end Client sees every Billing on the Project, but not the Subcontract itself", async () => {
      const engagement = await subcontract();
      await transferProposal(STUDIO_DAO, 40, "100");
      await transferProposal(CREW_DAO, 41, "300");
      await bill(studio(), 40);
      await bill(crew(), 41);
      const acme = await world.manager("acme-owner", "acme");

      const billed = await run(
        services.portal.listBillings(world.context("acme-owner", "acme"), {
          engagementId: acmeEngagement,
          limit: 50,
        }),
      );

      expect(billed.data.map((b) => b.payingDaoAccountId).sort()).toEqual(
        [CREW_DAO, STUDIO_DAO].sort(),
      );
      expect((await world.engagements.list(acme)).data.map((e) => e.id)).toEqual([acmeEngagement]);
      await expect(world.engagements.get(acme, engagement.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("the hiring Agency sees the Subcontractor's Billings and assignments on its Project", async () => {
      await subcontract();
      await transferProposal(CREW_DAO, 50, "300");
      await bill(crew(), 50);
      await run(
        services.assignments.create(await crew(), {
          projectId: "site",
          nearAccount: "crew-dev.near",
        }),
      );

      const billed = await run(services.billings.list(await treasury(studio()), { limit: 50 }));
      const assigned = await run(services.assignments.listAll(await studio()));

      expect(billed.data).toEqual([
        expect.objectContaining({ projectId: "site", payingDaoAccountId: CREW_DAO }),
      ]);
      expect(assigned.data).toEqual([
        expect.objectContaining({ projectId: "site", nearAccount: "crew-dev.near" }),
      ]);
    });
  });
});
