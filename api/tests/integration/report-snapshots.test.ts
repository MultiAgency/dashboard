import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createReportsService } from "../../src/services/reports";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const STUDIO_DAO = "studio-reports.sputnik-dao.near";
const CREW_DAO = "crew-reports.sputnik-dao.near";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "globex", name: "Globex", slug: "globex" },
  { id: "crew", name: "Crew", slug: "crew", daoAccountId: CREW_DAO },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "studio-member", organizationId: "studio", role: "member" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-member", organizationId: "acme", role: "member" as const },
  { userId: "globex-owner", organizationId: "globex", role: "owner" as const },
  { userId: "crew-owner", organizationId: "crew", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

const projects = [{ ...project("site", "studio"), slug: "site", title: "Website" }];

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);

describe("saved reports", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let reports: ReturnType<typeof createReportsService>;
  let portal: ReturnType<typeof createClientPortalService>;
  let acmeEngagement: string;
  let globexEngagement: string;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects });
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    const agency = createAgencyService(db, world.plugins, world.directory, listings, ledgers);
    reports = createReportsService(
      db,
      world.directory,
      world.plugins,
      world.organizations.directory,
    );
    portal = createClientPortalService(
      world.access,
      agency,
      createBillingsService(db, world.directory, world.access),
      reports,
      world.directory,
      ledgers,
    );
    acmeEngagement = await engage("acme", "acme-owner", "Acme Corp");
    globexEngagement = await engage("globex", "globex-owner", "Globex");
    await db
      .insert(budgets)
      .values([
        budget("acme-budget", acmeEngagement, "700"),
        budget("globex-budget", globexEngagement, "300"),
      ]);
  });

  afterEach(async () => {
    await pg.close();
  });

  const studio = () => world.manager("studio-admin", "studio");

  function budget(id: string, engagementId: string, amount: string) {
    return {
      id,
      projectId: "site",
      tokenId: "near",
      amount,
      actorAccountId: "admin.near",
      engagementId,
      fundingDaoAccountId: STUDIO_DAO,
    };
  }

  async function engage(slug: string, ownerId: string, name: string) {
    const proposed = await world.engagements.propose(await studio(), { slug, name });
    await world.engagements.accept(await world.manager(ownerId, slug), proposed.id);
    await world.engagements.share(await studio(), { engagementId: proposed.id, projectId: "site" });
    return proposed.id;
  }

  const clientReport = (userId: string, organizationId: string, engagementId: string) =>
    run(
      portal.generateReport(world.context(userId, organizationId), {
        engagementId,
        note: "For the board",
        startDate: "2020-01-01",
        endDate: "2099-12-31",
      }),
    );

  test("a Client's report covers only its Engagement and is saved with its note for its members", async () => {
    const generated = await clientReport("acme-member", "acme", acmeEngagement);

    expect(generated.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);
    const listed = await portal.listReports(world.context("acme-owner", "acme"), {
      engagementId: acmeEngagement,
    });
    expect(listed.data).toEqual([
      expect.objectContaining({
        id: generated.id,
        engagementId: acmeEngagement,
        generatedByUserId: "acme-member",
        note: "For the board",
        startDate: "2020-01-01",
        endDate: "2099-12-31",
      }),
    ]);
    const opened = await portal.getReport(world.context("acme-owner", "acme"), {
      engagementId: acmeEngagement,
      id: generated.id,
    });
    expect(opened.report).toMatchObject({
      notes: "For the board",
      clientBreakdown: [expect.objectContaining({ clientName: "Acme Corp" })],
    });
  });

  test("a saved report is visible only to the Organization that generated it", async () => {
    const acmeReport = await clientReport("acme-member", "acme", acmeEngagement);
    const agencyReport = await run(
      reports.generateSaved(
        await studio(),
        { engagementId: acmeEngagement, note: "Internal" },
        { organizationId: "studio", userId: "studio-admin" },
      ),
    );

    const agencyList = await reports.listSaved("studio");
    expect(agencyList.data.map((r) => r.id)).toEqual([agencyReport.id]);
    await expect(reports.getSaved("studio", acmeReport.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (
        await portal.listReports(world.context("acme-owner", "acme"), {
          engagementId: acmeEngagement,
        })
      ).data.map((r) => r.id),
    ).toEqual([acmeReport.id]);
    await expect(
      portal.getReport(world.context("acme-owner", "acme"), {
        engagementId: acmeEngagement,
        id: agencyReport.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      portal.getReport(world.context("globex-owner", "globex"), {
        engagementId: globexEngagement,
        id: acmeReport.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      portal.listReports(world.context("globex-owner", "globex"), {
        engagementId: acmeEngagement,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("the Agency's report for one Engagement names only that Client", async () => {
    const report = await run(
      reports.generateSaved(
        await studio(),
        { engagementId: globexEngagement },
        { organizationId: "studio", userId: "studio-admin" },
      ),
    );

    expect(report.clientBreakdown.map((row) => row.clientName)).toEqual(["Globex"]);
    expect((await reports.listSaved("studio", { engagementId: acmeEngagement })).data).toEqual([]);
  });

  test("a Subcontractor's saved report leaves out the end Client's money", async () => {
    const subcontract = await world.engagements.subcontract(await studio(), {
      slug: "crew",
      name: "Crew",
      projectIds: ["site"],
    });

    const report = await clientReport("crew-owner", "crew", subcontract.id);

    expect(report.overview.budgetByToken).toEqual([]);
    expect(report.clientBreakdown.map((row) => row.clientName)).toEqual(["Crew"]);
    const opened = await portal.getReport(world.context("crew-owner", "crew"), {
      engagementId: subcontract.id,
      id: report.id,
    });
    expect(opened.report.overview.budgetByToken).toEqual([]);
  });
});
