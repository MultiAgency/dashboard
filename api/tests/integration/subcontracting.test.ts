import { beforeEach, describe, expect, test } from "vitest";
import { budgets, proposals } from "../../src/db/schema";
import { runEffect as run } from "../../src/lib/context";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBillingsService } from "../../src/services/billings";
import { createBudgetsService, writeEngagementEntries } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { type AgencyScope, requireTreasury } from "../../src/services/organization-access";
import { createReportsService } from "../../src/services/reports";
import type { DaoProposalStatus } from "../../src/services/sputnik";
import { engagementWorld, refused } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

let daoCounter = 0;

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "crew-owner", organizationId: "crew", role: "owner" as const },
  { userId: "crew-member", organizationId: "crew", role: "member" as const },
  { userId: "rival-admin", organizationId: "rival", role: "owner" as const },
];

describe("subcontracting", () => {
  const database = migratedDatabase({ perTest: true });
  let STUDIO_DAO: string;
  let CREW_DAO: string;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let services: ReturnType<typeof buildServices>;
  let acmeEngagement: string;

  function buildServices() {
    const { db } = database;
    const plugins = {
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
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
    world = await engagementWorld(database.db, {
      organizations: [
        { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
        { id: "acme", name: "Acme Corp", slug: "acme" },
        { id: "crew", name: "Crew", slug: "crew", daoAccountId: CREW_DAO },
        { id: "rival", name: "Rival", slug: "rival" },
      ],
      members,
      users: members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` })),
      projects: [
        { ...project("site", "studio"), slug: "site", title: "Website" },
        { ...project("internal", "studio"), slug: "internal", title: "Internal" },
        { ...project("rival-work", "rival"), slug: "rival-work", title: "Rival work" },
      ],
    });
    services = buildServices();
    acmeEngagement = (await world.activeEngagement("acme", ["site"])).id;
  });

  const studio = () => world.manager("studio-admin", "studio");
  const crew = () => world.manager("crew-owner", "crew");
  const crewMember = () => world.member("crew-member", "crew");
  const treasury = async (scope: Promise<AgencyScope>) => requireTreasury(await scope);
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
    await database.db.insert(proposals).values({
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

  async function bill(scope: Promise<AgencyScope>, proposalId: number, projectId = "site") {
    return run(
      services.billings.create(await treasury(scope), {
        projectId,
        proposalId: String(proposalId),
      }),
    );
  }

  async function assign(scope: Promise<AgencyScope>, nearAccount: string, projectId = "site") {
    return run(services.assignments.create(await scope, { projectId, nearAccount }));
  }

  describe("sharing in one step", () => {
    test("the Subcontract is active at once, with no acceptance, its managers are told and it shows under Shared with us", async () => {
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
      await refused(world.engagements.accept(await crew(), engagement.id), "NOT_PROPOSED");
      expect((await world.engagements.sharedWithUs(await crewMember())).data).toEqual([
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
      await refused(subcontract(["rival-work"]), "NOT_FOUND");
      await refused(
        world.engagements.subcontract(await studio(), { slug: "studio", name: "Studio" }),
        "SELF_ENGAGEMENT",
      );
      await refused(
        world.engagements.subcontract(await studio(), { slug: "crew", name: "Crew Ltd" }),
        "NOT_FOUND",
      );
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
      expect(world.emails.at(-1)?.html).toContain('href="https://app.example/accept-invitation/');
    });

    test("a new Subcontractor created with a Project shares it at once, before and after its first admin joins", async () => {
      const engagement = await world.engagements.createWithClient(await studio(), {
        name: "New Crew",
        slug: "new-crew",
        adminEmail: "lead@newcrew.example",
        projectIds: ["site"],
        kind: "subcontract",
      });

      expect(engagement.projectIds).toEqual(["site"]);
      expect((await world.engagements.get(await studio(), engagement.id)).projectIds).toEqual([
        "site",
      ]);
      const invitationId = new URL(engagement.invitation!.link, "https://app.example").pathname
        .split("/")
        .pop()!;
      world.organizations.acceptInvitation(invitationId, "new-crew-lead");
      expect(
        (
          await world.engagements.sharedWithUs(
            await world.manager("new-crew-lead", engagement.client.id),
          )
        ).data,
      ).toEqual([
        expect.objectContaining({
          engagementId: engagement.id,
          readOnly: false,
          project: expect.objectContaining({ id: "site", title: "Website" }),
        }),
      ]);
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

      await assign(crewMember(), "dev.near");
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
      expect((await run(services.assignments.listAll(await crew()))).data).toEqual([
        expect.objectContaining({
          projectId: "site",
          projectTitle: "Website",
          nearAccount: "dev.near",
        }),
      ]);
    });

    test("cannot edit the Project, publish Listings, add Budget entries or work on other Projects", async () => {
      await subcontract();
      await transferProposal(CREW_DAO, 2, "10");
      const scope = await crew();

      await refused(
        run(services.agency.updateProject(scope, { id: "site", title: "Taken over" })),
        "NOT_FOUND",
      );
      await refused(
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
        "NOT_FOUND",
      );
      await refused(
        run(
          services.budgets.create(requireTreasury(scope), {
            projectId: "site",
            tokenId: "near",
            amount: "1000",
          }),
        ),
        "NOT_FOUND",
      );
      await refused(assign(crew(), "dev.near", "internal"), "NOT_FOUND");
      await refused(bill(crew(), 2, "internal"), "NOT_FOUND");
      expect(await database.db.select().from(budgets)).toEqual([]);
    });

    test("after the Subcontract ends the shared Project is read-only for the Subcontractor", async () => {
      const engagement = await subcontract();
      await world.engagements.end(await studio(), engagement.id);

      await refused(assign(crew(), "dev.near"), "ENGAGEMENT_ENDED");
      expect((await world.engagements.sharedWithUs(await crew())).data).toEqual([
        expect.objectContaining({ engagementId: engagement.id, readOnly: true }),
      ]);
    });
  });

  describe("assignments", () => {
    test("record who assigned them; both sides see all and remove only their own", async () => {
      await subcontract();
      await assign(studio(), "own.near");
      await assign(crew(), "crew-dev.near");
      const remove = async (scope: Promise<AgencyScope>, nearAccount: string) =>
        run(services.assignments.delete(await scope, { projectId: "site", nearAccount }));

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

      await expect(remove(crew(), "own.near")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(remove(studio(), "crew-dev.near")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await remove(crew(), "crew-dev.near");
      await remove(studio(), "own.near");
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

      await refused(
        run(
          services.assignments.create(await crew(), {
            projectId: "site",
            nearAccount: "dev.near",
            role: "intern",
          }),
        ),
        "ASSIGNED_BY_OTHER",
      );
      expect((await run(services.assignments.list(await crew(), "site"))).data).toEqual([
        expect.objectContaining({ nearAccount: "dev.near", role: "lead" }),
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
      const listed = await run(services.billings.list(await treasury(studio()), { limit: 50 }));
      expect(listed.data.map((b) => [b.payingDaoAccountId, b.amount]).sort()).toEqual(
        [
          [CREW_DAO, "300"],
          [STUDIO_DAO, "100"],
        ].sort(),
      );
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
      await refused(
        run(services.billings.delete(await treasury(crew()), { id: own.billing.id })),
        "NOT_FOUND",
      );

      await run(services.billings.delete(await treasury(crew()), { id: theirs.billing.id }));
      await run(services.billings.delete(await treasury(studio()), { id: own.billing.id }));
    });
  });

  describe("rollups by funding and paying DAO", () => {
    beforeEach(async () => {
      await subcontract();
      await database.db.insert(budgets).values({
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
      const engagementId = (await world.engagements.list(await crew())).data[0]!.id;
      const context = world.context("crew-owner", "crew");

      const rollup = await run(
        services.portal.getBudget(context, { engagementId, projectId: "site" }),
      );
      const summary = await run(services.portal.dashboardSummary(context, { engagementId }));
      const report = await run(services.portal.generateReport(context, { engagementId }));
      const billed = await run(services.portal.listBillings(context, { engagementId, limit: 50 }));

      expect(rollup).toEqual({
        budgets: [],
        subcontractorSpend: [
          { daoAccountId: CREW_DAO, tokenId: "near", committed: "0", paid: "300" },
        ],
      });
      expect(summary.remainingByToken).toEqual([]);
      expect(report.overview.budgetByToken).toEqual([]);
      expect(report.clientBreakdown.map((row) => row.clientName)).toEqual(["Crew"]);
      expect(billed.data.map((b) => b.payingDaoAccountId)).toEqual([CREW_DAO]);
    });

    test("pulling budget back is limited by the owner's own spend only", async () => {
      await world.prepayments.record(await studio(), {
        engagementId: acmeEngagement,
        tokenId: "near",
        amount: "1000",
        period: "2026-08",
      });
      const pullBack = (amount: string) =>
        writeEngagementEntries(database.db, {
          engagementId: acmeEngagement,
          actorAccountId: "admin.near",
          entries: [{ projectId: "site", tokenId: "near", amount, note: null }],
          statuses: new Map(),
        });
      await pullBack("-900");

      await expect(pullBack("-1")).rejects.toMatchObject({ reason: "REMAINING_EXCEEDED" });
    });
  });

  describe("visibility", () => {
    test("the Subcontractor never reaches the end Client's Engagement", async () => {
      await subcontract();
      const scope = await crew();

      expect((await world.engagements.list(scope)).data.map((e) => e.kind)).toEqual([
        "subcontract",
      ]);
      await refused(world.engagements.get(scope, acmeEngagement), "NOT_FOUND");
      await refused(world.prepayments.list(scope, { engagementId: acmeEngagement }), "NOT_FOUND");
      await refused(world.changeOrders.plan(scope, { engagementId: acmeEngagement }), "NOT_FOUND");
      await refused(
        world.access.sharedWith(world.context("crew-owner", "crew"), acmeEngagement),
        "NOT_FOUND",
      );
    });

    test("the end Client sees every Billing with its paying DAO's status, but not the Subcontract", async () => {
      const engagement = await subcontract();
      await transferProposal(STUDIO_DAO, 40, "100");
      await transferProposal(CREW_DAO, 41, "300", "Approved");
      await transferProposal(STUDIO_DAO, 41, "300", "Rejected");
      await bill(studio(), 40);
      await bill(crew(), 41);
      const acme = await world.manager("acme-owner", "acme");

      const billed = await run(
        services.portal.listBillings(world.context("acme-owner", "acme"), {
          engagementId: acmeEngagement,
          limit: 50,
        }),
      );

      const byStudio = await run(services.billings.list(await treasury(studio()), { limit: 50 }));

      for (const listed of [billed, byStudio]) {
        expect(
          listed.data.map((b) => [b.payingDaoAccountId, b.proposalId, b.status]).sort(),
        ).toEqual(
          [
            [CREW_DAO, "41", "Approved"],
            [STUDIO_DAO, "40", "Approved"],
          ].sort(),
        );
      }
      expect((await world.engagements.list(acme)).data.map((e) => e.id)).toEqual([acmeEngagement]);
      await refused(world.engagements.get(acme, engagement.id), "NOT_FOUND");
    });
  });
});
