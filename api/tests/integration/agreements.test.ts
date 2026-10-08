import type { Effect } from "every-plugin/effect";
import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { budgets, engagements, reportSnapshots } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import {
  type AgreementFields,
  agreementsOfEngagement,
  createAgreementsService,
} from "../../src/services/agreements";
import { createBillingsService } from "../../src/services/billings";
import { createBudgetsService } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { requireTreasury } from "../../src/services/organization-access";
import { createReportsService } from "../../src/services/reports";
import {
  CLIENT_WORK_SEED,
  type EngagementWorld,
  engagementWorld,
  refused,
  STUDIO_DAO,
} from "../fakes/engagements";
import { project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);

const SEED = {
  ...CLIENT_WORK_SEED,
  projects: [
    ...CLIENT_WORK_SEED.projects,
    { ...project("internal", "studio"), slug: "internal", title: "Internal" },
  ],
};

const builders = {
  builders: () => ({ listBuilders: async () => ({ data: [] }) }),
} as unknown as Partial<PluginsClient>;

describe("client agreements", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let world: EngagementWorld;
  let agreements: ReturnType<typeof createAgreementsService>;
  let acme: string;

  beforeEach(async () => {
    db = database.db;
    world = await engagementWorld(db, SEED);
    agreements = createAgreementsService(db);
    acme = (await world.activeEngagement("acme", ["site"])).id;
  });

  const studio = () => world.manager("studio-admin", "studio");
  const treasury = async () => requireTreasury(await studio());
  const fields = (overrides: Partial<AgreementFields> = {}): AgreementFields => ({
    kind: "retainer",
    title: "Acme · October",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    tokenId: "near",
    agreedAmount: "2500",
    ...overrides,
  });
  const create = async (overrides: Partial<AgreementFields> = {}, engagementId = acme) =>
    agreements.create(await studio(), { engagementId, ...fields(overrides) });

  function reportsService() {
    const plugins = { ...world.plugins, ...builders } as PluginsClient;
    return createReportsService(db, world.directory, plugins, world.organizations.directory);
  }

  function portal() {
    const plugins = { ...world.plugins, ...builders } as PluginsClient;
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    return createClientPortalService(
      world.access,
      createAgencyService(db, plugins, world.directory, listings, ledgers),
      createBillingsService(db, world.directory, world.access),
      reportsService(),
      world.directory,
      ledgers,
      (engagementId) => agreementsOfEngagement(db, engagementId),
    );
  }

  test("an agency adds retainers and project agreements to a client engagement", async () => {
    await create({ title: "Acme · September", startDate: "2026-09-01", endDate: "2026-09-30" });
    await create({
      kind: "project",
      title: "Acme · Website rebuild",
      startDate: "2026-10-15",
      endDate: "2026-12-15",
      agreedAmount: "9000",
    });

    const listed = await agreements.list(await studio(), { engagementId: acme });

    expect(listed.data.map((a) => [a.title, a.kind, a.allocated, a.budgetCount])).toEqual([
      ["Acme · Website rebuild", "project", "0", 0],
      ["Acme · September", "retainer", "0", 0],
    ]);
    expect(listed.data[0]).toMatchObject({ createdBy: (await studio()).actorId, note: null });
  });

  test("an agreement needs a title, a start on or before its end, and an amount", async () => {
    await refused(create({ endDate: "2026-09-30" }), "INVALID_PERIOD");
    await refused(create({ agreedAmount: "0" }), "AMOUNT_NOT_POSITIVE");
    await refused(create({ title: "   " }), "TITLE_REQUIRED");
  });

  test("only the agency's own active client engagements take agreements", async () => {
    const rival = await world.manager("rival-admin", "rival");
    await refused(agreements.create(rival, { engagementId: acme, ...fields() }), "NOT_FOUND");
    await refused(agreements.list(rival, { engagementId: acme }), "NOT_FOUND");

    await db.update(engagements).set({ status: "ended" });
    await refused(create(), "NOT_ACTIVE");
    expect((await agreements.list(await studio(), { engagementId: acme })).data).toEqual([]);
  });

  test("a budget on a client's project is attached to one of their agreements; an internal one needn't be", async () => {
    const budgetsService = createBudgetsService(db, world.directory);
    const october = await create();

    await refused(
      run(
        budgetsService.create(await treasury(), {
          projectId: "site",
          tokenId: "near",
          amount: "1000",
        }),
      ),
      "AGREEMENT_REQUIRED",
    );
    const { budget } = await run(
      budgetsService.create(await treasury(), {
        projectId: "site",
        tokenId: "near",
        amount: "1000",
        agreementId: october.id,
      }),
    );
    expect(budget).toMatchObject({ agreementId: october.id, effectiveOn: "2026-10-01" });

    await refused(
      run(
        budgetsService.create(await treasury(), {
          projectId: "site",
          tokenId: "usdc",
          amount: "5",
          agreementId: october.id,
        }),
      ),
      "AGREEMENT_TOKEN_MISMATCH",
    );
    await refused(
      run(
        budgetsService.create(await treasury(), {
          projectId: "internal",
          tokenId: "near",
          amount: "5",
          agreementId: october.id,
        }),
      ),
      "AGREEMENT_NOT_FOR_PROJECT",
    );
    const internal = await run(
      budgetsService.create(await treasury(), {
        projectId: "internal",
        tokenId: "near",
        amount: "5",
      }),
    );
    expect(internal.budget.agreementId).toBeNull();

    const listed = await agreements.list(await studio(), { engagementId: acme });
    expect(listed.data[0]).toMatchObject({ allocated: "1000", budgetCount: 1 });
    expect((await agreements.list(await studio(), { projectId: "site" })).requiresAgreement).toBe(
      true,
    );
    expect(
      (await agreements.list(await studio(), { projectId: "internal" })).requiresAgreement,
    ).toBe(false);
  });

  test("editing an existing budget attaches it to an agreement, never to another client's", async () => {
    const budgetsService = createBudgetsService(db, world.directory);
    const october = await create();
    const globex = (await world.activeEngagement("globex", ["internal"])).id;
    const globexAgreement = await create({ title: "Globex" }, globex);
    await db.insert(budgets).values({
      id: "old-entry",
      projectId: "site",
      tokenId: "near",
      amount: "700",
      note: "August - September",
      actorAccountId: "admin.near",
      fundingDaoAccountId: STUDIO_DAO,
    });

    await refused(
      run(
        budgetsService.update(await treasury(), {
          id: "old-entry",
          agreementId: globexAgreement.id,
        }),
      ),
      "AGREEMENT_NOT_FOR_PROJECT",
    );
    const { budget } = await run(
      budgetsService.update(await treasury(), { id: "old-entry", agreementId: october.id }),
    );

    expect(budget).toMatchObject({ agreementId: october.id, amount: "700" });
    expect((await agreements.list(await studio(), { engagementId: acme })).data[0]).toMatchObject({
      allocated: "700",
    });
  });

  test("an agreement with budgets keeps its token and can't be deleted; an empty one can", async () => {
    const budgetsService = createBudgetsService(db, world.directory);
    const used = await create();
    const empty = await create({ title: "Spare" });
    await run(
      budgetsService.create(await treasury(), {
        projectId: "site",
        tokenId: "near",
        amount: "10",
        agreementId: used.id,
      }),
    );

    await refused(agreements.remove(await studio(), { id: used.id }), "AGREEMENT_IN_USE");
    await refused(
      agreements.update(await studio(), { id: used.id, tokenId: "usdc" }),
      "TOKEN_IN_USE",
    );
    const renamed = await agreements.update(await studio(), {
      id: used.id,
      title: "Acme · October (revised)",
      endDate: "2026-11-15",
      agreedAmount: "3000",
    });
    expect(renamed).toMatchObject({
      title: "Acme · October (revised)",
      endDate: "2026-11-15",
      agreedAmount: "3000",
    });
    expect(await agreements.remove(await studio(), { id: empty.id })).toEqual({ deleted: true });
  });

  test("a report for an agreement counts its budgets in full, over its dates", async () => {
    const budgetsService = createBudgetsService(db, world.directory);
    const retainer = await create({
      title: "Acme · Sep 15 – Oct 14",
      startDate: "2026-09-15",
      endDate: "2026-10-14",
    });
    const next = await create({
      title: "Acme · Oct 15 – Nov 14",
      startDate: "2026-10-15",
      endDate: "2026-11-14",
    });
    for (const [agreementId, amount] of [
      [retainer.id, "1000"],
      [retainer.id, "250"],
      [next.id, "900"],
    ] as const) {
      await run(
        budgetsService.create(await treasury(), {
          projectId: "site",
          tokenId: "near",
          amount,
          agreementId,
          effectiveOn: "2026-11-30",
        }),
      );
    }
    const reports = reportsService();

    const report = await run(reports.generate(await studio(), { agreementId: retainer.id }));

    expect(report.overview.budgetByToken).toEqual([{ tokenId: "near", amount: "1250" }]);
    expect(report.overview.period).toBe("2026-09-15 – 2026-10-14");
    expect(report.agreement).toMatchObject({
      title: "Acme · Sep 15 – Oct 14",
      kind: "retainer",
      agreedAmount: "2500",
      allocated: "1250",
    });

    const saved = await run(
      reports.generateSaved(
        await studio(),
        { agreementId: retainer.id },
        { organizationId: "studio", userId: "studio-admin" },
      ),
    );
    const [snapshot] = await db.select().from(reportSnapshots);
    expect(snapshot).toMatchObject({
      id: saved.id,
      engagementId: acme,
      startDate: "2026-09-15",
      endDate: "2026-10-14",
    });
    expect((await reports.listSaved("studio")).data[0]?.agreementTitle).toBe(
      "Acme · Sep 15 – Oct 14",
    );
  });

  test("a client sees its agreements and runs reports for them, and only for them", async () => {
    const retainer = await create();
    const globex = (await world.activeEngagement("globex", ["site"])).id;
    const acmeOwner = world.context("acme-owner", "acme");
    const clientPortal = portal();

    const listed = await clientPortal.listAgreements(acmeOwner, { engagementId: acme });
    expect(listed.data.map((a) => a.title)).toEqual(["Acme · October"]);

    const report = await run(
      clientPortal.previewReport(acmeOwner, { engagementId: acme, agreementId: retainer.id }),
    );
    expect(report.agreement?.title).toBe("Acme · October");

    const globexOwner = world.context("globex-owner", "globex");
    await refused(
      run(
        clientPortal.previewReport(globexOwner, { engagementId: globex, agreementId: retainer.id }),
      ),
      "NOT_FOUND",
    );
  });
});
