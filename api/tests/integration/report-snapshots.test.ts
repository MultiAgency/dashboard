import type { Effect } from "every-plugin/effect";
import { beforeEach, describe, expect, test } from "vitest";
import { budgets, reportSnapshots } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { ALLOCATION_PLAN_ENABLED } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import type { NotifyInput } from "../../src/services/notifications";
import { createReportsService, type ReportViewer } from "../../src/services/reports";
import { clientWorkWorld, refused, STUDIO_DAO } from "../fakes/engagements";

// Skipped while the Allocation plan is omitted for now; see ALLOCATION_PLAN_ENABLED.

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);
const near = (amount: string) => [{ tokenId: "near", amount }];

describe("saved reports", () => {
  const state = clientWorkWorld();
  let reports: ReturnType<typeof createReportsService>;
  let portal: ReturnType<typeof createClientPortalService>;
  let acmeEngagement: string;
  let globexEngagement: string;
  let sent: NotifyInput[];

  beforeEach(async () => {
    const { db, world } = state;
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    sent = [];
    reports = createReportsService(
      db,
      world.directory,
      world.plugins,
      world.organizations.directory,
      {
        notify: async (input: NotifyInput) => {
          sent.push(input);
          return { recipients: 1, emailed: 0 };
        },
      },
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
  const agencyViewer = (userId: string, canManage: boolean): ReportViewer => ({
    organizationId: "studio",
    userId,
    canManage,
    side: "agency",
  });
  const admin = agencyViewer("studio-admin", true);
  const member = agencyViewer("studio-member", false);
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

  test.skipIf(!ALLOCATION_PLAN_ENABLED)(
    "budget on a co-funded Project counts only for the Engagement that funded it",
    async () => {
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
    },
  );

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

  test("a shared agency report shows up for that Client only, labelled as from the agency, until it is unshared", async () => {
    const internal = await agencyReport(acmeEngagement);

    const shared = await reports.setShared(admin, internal.id, true);
    expect(shared).toMatchObject({ id: internal.id, canShare: true, fromAgency: false });
    expect(shared.sharedAt).toBeInstanceOf(Date);
    expect(sent).toEqual([
      expect.objectContaining({
        organizationId: "acme",
        kind: "report_shared",
        link: `/client/${acmeEngagement}/reports?report=${internal.id}`,
      }),
    ]);

    const acmeList = await portal.listReports(acme(), { engagementId: acmeEngagement });
    expect(acmeList.data).toEqual([
      expect.objectContaining({
        id: internal.id,
        fromAgency: true,
        canDelete: false,
        canShare: false,
      }),
    ]);
    const opened = await portal.getReport(acme(), {
      engagementId: acmeEngagement,
      id: internal.id,
    });
    expect(opened.report.notes).toBe("Internal");
    const globex = state.world.context("globex-owner", "globex");
    await refused(
      portal.getReport(globex, { engagementId: globexEngagement, id: internal.id }),
      "NOT_FOUND",
    );

    await reports.setShared(admin, internal.id, true);
    expect(sent).toHaveLength(1);

    await reports.setShared(admin, internal.id, false);
    expect((await portal.listReports(acme(), { engagementId: acmeEngagement })).data).toEqual([]);
    await refused(
      portal.getReport(acme(), { engagementId: acmeEngagement, id: internal.id }),
      "NOT_FOUND",
    );
  });

  test("only an owner or admin shares, and only a report for one client", async () => {
    const forAcme = await agencyReport(acmeEngagement);
    const agencyWide = await agencyReport();

    await refused(reports.setShared(member, forAcme.id, true), "MANAGER_REQUIRED");
    await refused(reports.setShared(admin, agencyWide.id, true), "NOT_CLIENT_REPORT");
    await refused(
      reports.setShared({ ...admin, organizationId: "rival" }, forAcme.id, true),
      "NOT_FOUND",
    );
    expect((await reports.listSaved("studio", {}, member)).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: forAcme.id, canShare: false })]),
    );
    expect((await reports.listSaved("studio", {}, admin)).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: forAcme.id, canShare: true }),
        expect.objectContaining({ id: agencyWide.id, canShare: false }),
      ]),
    );
  });

  test("a report is deleted by the person who saved it or an owner or admin, and a shared one leaves the Client too", async () => {
    const byAdmin = await agencyReport(acmeEngagement);
    const byMember = await run(
      reports.generateSaved(
        await state.world.member("studio-member", "studio"),
        { engagementId: acmeEngagement },
        { organizationId: "studio", userId: "studio-member" },
      ),
    );
    await reports.setShared(admin, byAdmin.id, true);

    await refused(reports.deleteSaved(member, byAdmin.id), "NOT_REPORT_AUTHOR");
    await refused(
      reports.deleteSaved({ ...admin, organizationId: "rival" }, byAdmin.id),
      "NOT_FOUND",
    );
    expect(await reports.deleteSaved(member, byMember.id)).toEqual({ deleted: true });
    expect(await reports.deleteSaved(admin, byAdmin.id)).toEqual({ deleted: true });

    expect((await reports.listSaved("studio")).data).toEqual([]);
    expect((await portal.listReports(acme(), { engagementId: acmeEngagement })).data).toEqual([]);
  });

  test("a Client deletes its own reports by the same rule, never an agency report shared with it", async () => {
    const byMember = await clientReport("acme-member", "acme", acmeEngagement);
    const byOwner = await clientReport("acme-owner", "acme", acmeEngagement);
    const internal = await agencyReport(acmeEngagement);
    await reports.setShared(admin, internal.id, true);
    const acmeMember = state.world.context("acme-member", "acme");

    await refused(
      portal.deleteReport(acmeMember, { engagementId: acmeEngagement, id: byOwner.id }),
      "NOT_REPORT_AUTHOR",
    );
    await refused(
      portal.deleteReport(acme(), { engagementId: acmeEngagement, id: internal.id }),
      "NOT_FOUND",
    );
    expect(
      await portal.deleteReport(acmeMember, { engagementId: acmeEngagement, id: byMember.id }),
    ).toEqual({ deleted: true });
    expect(
      await portal.deleteReport(acme(), { engagementId: acmeEngagement, id: byOwner.id }),
    ).toEqual({ deleted: true });
    expect(
      (await portal.listReports(acme(), { engagementId: acmeEngagement })).data.map((r) => r.id),
    ).toEqual([internal.id]);
  });

  test("the Client never receives builder payouts, from its own reports or shared ones", async () => {
    const payouts = [
      { nearAccount: "alice.near", name: "Alice", billedByToken: near("50"), billingCount: 1 },
    ];
    const internal = await agencyReport(acmeEngagement);
    const [row] = await state.db.select().from(reportSnapshots);
    await state.db
      .update(reportSnapshots)
      .set({ payload: JSON.stringify({ ...JSON.parse(row!.payload), contributorStats: payouts }) });
    await reports.setShared(admin, internal.id, true);

    const agencyView = await reports.getSaved("studio", internal.id);
    expect(agencyView.report.contributorStats).toEqual(payouts);
    const clientView = await portal.getReport(acme(), {
      engagementId: acmeEngagement,
      id: internal.id,
    });
    expect(clientView.report.contributorStats).toEqual([]);
    const generated = await clientReport("acme-owner", "acme", acmeEngagement);
    expect(generated.contributorStats).toEqual([]);
    const preview = await run(portal.previewReport(acme(), { engagementId: acmeEngagement }));
    expect(preview.contributorStats).toEqual([]);
  });

  test("a preview is not saved", async () => {
    await run(portal.previewReport(acme(), { engagementId: acmeEngagement }));
    await run(reports.generate(await studio(), { engagementId: acmeEngagement }));

    expect(await state.db.select().from(reportSnapshots)).toEqual([]);
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
  });
});
