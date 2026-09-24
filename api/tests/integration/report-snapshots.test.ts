import type { Effect } from "every-plugin/effect";
import { beforeEach, describe, expect, test } from "vitest";
import { budgets } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createReportsService } from "../../src/services/reports";
import { clientWorkWorld, refused, STUDIO_DAO } from "../fakes/engagements";

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);
const near = (amount: string) => [{ tokenId: "near", amount }];

describe("saved reports", () => {
  const state = clientWorkWorld();
  let reports: ReturnType<typeof createReportsService>;
  let portal: ReturnType<typeof createClientPortalService>;
  let acmeEngagement: string;
  let globexEngagement: string;

  beforeEach(async () => {
    const { db, world } = state;
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    reports = createReportsService(
      db,
      world.directory,
      world.plugins,
      world.organizations.directory,
    );
    portal = createClientPortalService(
      world.access,
      createAgencyService(db, world.plugins, world.directory, listings, ledgers),
      createBillingsService(db, world.directory, world.access),
      reports,
      world.directory,
      ledgers,
    );
    acmeEngagement = (await world.activeEngagement("acme", ["site"])).id;
    globexEngagement = (await world.activeEngagement("globex", ["site"])).id;
    await db
      .insert(budgets)
      .values([
        budget("acme-budget", acmeEngagement, "700"),
        budget("globex-budget", globexEngagement, "300"),
      ]);
  });

  const studio = () => state.world.manager("studio-admin", "studio");
  const acme = () => state.world.context("acme-owner", "acme");
  const agencyReport = async (engagementId?: string) =>
    run(
      reports.generateSaved(
        await studio(),
        { engagementId, note: "Internal" },
        { organizationId: "studio", userId: "studio-admin" },
      ),
    );

  function budget(id: string, engagementId: string | null, amount: string) {
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

  const clientReport = (userId: string, organizationId: string, engagementId: string) =>
    run(
      portal.generateReport(state.world.context(userId, organizationId), {
        engagementId,
        note: "For the board",
        startDate: "2020-01-01",
        endDate: "2099-12-31",
      }),
    );

  test("a Client's report covers only its Engagement and is saved with its note for its members", async () => {
    const generated = await clientReport("acme-member", "acme", acmeEngagement);

    expect(generated.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);
    const listed = await portal.listReports(acme(), { engagementId: acmeEngagement });
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
    const opened = await portal.getReport(acme(), {
      engagementId: acmeEngagement,
      id: generated.id,
    });
    expect(opened.report).toMatchObject({
      notes: "For the board",
      clientBreakdown: [expect.objectContaining({ clientName: "Acme Corp" })],
    });
  });

  test("budget on a co-funded Project counts only for the Engagement that funded it", async () => {
    await state.db.insert(budgets).values(budget("internal", null, "50"));

    const acmeView = await clientReport("acme-member", "acme", acmeEngagement);
    const globexView = await clientReport("globex-owner", "globex", globexEngagement);
    const agencyAcme = await agencyReport(acmeEngagement);
    const agencyWide = await agencyReport();

    expect(acmeView.overview.budgetByToken).toEqual(near("700"));
    expect(acmeView.clientBreakdown[0]?.budgetByToken).toEqual(near("700"));
    expect(globexView.overview.budgetByToken).toEqual(near("300"));
    expect(agencyAcme.overview.budgetByToken).toEqual(near("750"));
    expect(agencyAcme.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);
    expect(agencyWide.overview.budgetByToken).toEqual(near("1050"));
    expect(
      agencyWide.clientBreakdown
        .map((row) => [row.clientName, row.budgetByToken])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["Acme Corp", near("700")],
      ["Globex", near("300")],
    ]);
  });

  test("a saved report is visible only to the Organization that generated it", async () => {
    const acmeReport = await clientReport("acme-member", "acme", acmeEngagement);
    const internal = await agencyReport(acmeEngagement);

    expect((await reports.listSaved("studio")).data.map((r) => r.id)).toEqual([internal.id]);
    expect((await reports.listSaved("studio", { engagementId: globexEngagement })).data).toEqual(
      [],
    );
    await refused(reports.getSaved("studio", acmeReport.id), "NOT_FOUND");
    const acmeList = await portal.listReports(acme(), { engagementId: acmeEngagement });
    expect(acmeList.data.map((r) => r.id)).toEqual([acmeReport.id]);
    await refused(
      portal.getReport(acme(), { engagementId: acmeEngagement, id: internal.id }),
      "NOT_FOUND",
    );
    const globex = state.world.context("globex-owner", "globex");
    await refused(
      portal.getReport(globex, { engagementId: globexEngagement, id: acmeReport.id }),
      "NOT_FOUND",
    );
    await refused(portal.listReports(globex, { engagementId: acmeEngagement }), "NOT_FOUND");
  });

  test("a Subcontractor's saved report leaves out the end Client's money", async () => {
    const subcontract = await state.world.engagements.subcontract(await studio(), {
      slug: "crew",
      name: "Crew",
      projectIds: ["site"],
    });

    const report = await clientReport("crew-owner", "crew", subcontract.id);

    expect(report.overview.budgetByToken).toEqual([]);
    expect(report.clientBreakdown.map((row) => row.clientName)).toEqual(["Crew"]);
    const opened = await portal.getReport(state.world.context("crew-owner", "crew"), {
      engagementId: subcontract.id,
      id: report.id,
    });
    expect(opened.report.overview.budgetByToken).toEqual([]);
  });
});
