import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, budgets, proposals } from "../../src/db/schema";
import type { AgencyScope } from "../../src/lib/agency-scope";
import { runEffect } from "../../src/lib/context";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBillingsService } from "../../src/services/billings";
import { createBudgetsService } from "../../src/services/budgets";
import { createClientPortalService } from "../../src/services/client-portal";
import { createEngagementsService } from "../../src/services/engagements";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createPrepaymentsService } from "../../src/services/prepayments";
import { createProjectDirectory } from "../../src/services/project-directory";
import { createReportsService } from "../../src/services/reports";
import { inMemoryOrganizations } from "../fakes/organizations";
import { agencyScope, inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.near";
const SUB_DAO = "sub.sputnik-dao.near";

describe("subcontracting", () => {
  let pg: PGlite;
  let db: Database;

  const alpha = agencyScope(ALPHA_DAO, { organizationId: "org-alpha" }) as AgencyScope;
  const sub = agencyScope(SUB_DAO, { organizationId: "org-sub" }) as AgencyScope;
  const acme = orgScope("org-acme");

  const { client } = inMemoryProjects([project("site", "org-alpha"), project("app", "org-alpha")]);
  const directory = createProjectDirectory(() => client);
  const orgs = inMemoryOrganizations([
    { id: "org-alpha", name: "Alpha", daoAccountId: ALPHA_DAO },
    { id: "org-sub", name: "Sub Studio", daoAccountId: SUB_DAO },
    { id: "org-acme", name: "Acme" },
  ]);

  function services() {
    const listings = createListingsService(db, directory);
    const ledgers = createProjectLedgers(db, listings);
    const plugins = {
      projects: () => client,
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
    } as unknown as PluginsClient;
    const access = createOrganizationAccess(db, orgs.organizations, directory);
    const engagements = createEngagementsService(db, directory, orgs.organizations, access);
    const agency = createAgencyService(db, plugins, directory, listings, ledgers);
    const billingsService = createBillingsService(db, directory, engagements);
    const reports = createReportsService(db, directory, plugins);
    return {
      engagements,
      agency,
      listings,
      billings: billingsService,
      assignments: createAssignmentsService(db, directory, engagements),
      budgets: createBudgetsService(db, directory, access),
      prepayments: createPrepaymentsService(db, engagements),
      portal: createClientPortalService(
        engagements,
        agency,
        billingsService,
        reports,
        directory,
        ledgers,
        access,
      ),
    };
  }

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE engagements, engagement_projects, billings, budgets, project_contributors, proposals CASCADE",
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E>) => runEffect(effect);

  async function subcontract() {
    return run(
      services().engagements.subcontract(alpha, {
        subcontractorOrganizationId: "org-sub",
        projectIds: ["site"],
      }),
    );
  }

  async function transferProposal(dao: string, proposalId: number, amount: string) {
    await db.insert(proposals).values({
      daoAccountId: dao,
      proposalId,
      proposer: "someone.near",
      description: "payout",
      status: "Approved",
      kindType: "Transfer",
      transferTokenId: "usdc.near",
      transferReceiverId: "dev.near",
      transferAmount: amount,
      submissionTime: "0",
    });
  }

  test("a client Engagement does not block a subcontract with the same Organizations", async () => {
    const { engagements } = services();
    await run(
      engagements.accept(
        sub,
        (await run(engagements.propose(alpha, { clientOrganizationId: "org-sub" }))).id,
      ),
    );

    const handedOff = await subcontract();

    expect(handedOff.kind).toBe("subcontract");
    const listed = await run(engagements.list(alpha));
    expect(
      listed.data.filter((engagement) => engagement.client.organizationId === "org-sub"),
    ).toHaveLength(2);
  });

  test("a subcontract can record a Prepayment in the same step", async () => {
    const engagement = await run(
      services().engagements.subcontract(alpha, {
        subcontractorOrganizationId: "org-sub",
        projectIds: ["site"],
        prepayment: {
          tokenId: "usdc.near",
          amount: "1000",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        },
      }),
    );

    const recorded = await run(services().prepayments.list(alpha, engagement.id));
    expect(recorded.data).toMatchObject([
      { tokenId: "usdc.near", amount: "1000", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
    ]);
  });

  test("an Agency hands a Project to a Subcontractor in one step", async () => {
    const engagement = await subcontract();

    expect(engagement).toMatchObject({
      kind: "subcontract",
      status: "active",
      role: "agency",
      client: { organizationId: "org-sub" },
      projectIds: ["site"],
    });
    const seen = await run(services().portal.listProjects(sub, { engagementId: engagement.id }));
    expect(seen.data.map((p) => p.id)).toEqual(["site"]);
  });

  test("the Subcontractor assigns its own Contributors to shared Projects only", async () => {
    await subcontract();
    const { assignments } = services();

    await run(assignments.create(sub, { projectId: "site", nearAccount: "dev.near" }));
    await expect(
      run(assignments.create(sub, { projectId: "app", nearAccount: "dev.near" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ownerView = await run(assignments.list(alpha, "site"));
    expect(ownerView.data.map((a) => a.nearAccount)).toEqual(["dev.near"]);
    const subView = await run(assignments.listAll(sub));
    expect(subView.data.map((a) => [a.projectId, a.nearAccount])).toEqual([["site", "dev.near"]]);
  });

  test("the Subcontractor pays from its own Agency DAO and the hiring Agency sees it", async () => {
    await subcontract();
    const { billings: service } = services();
    await transferProposal(SUB_DAO, 7, "250");
    await db.insert(billings).values({
      id: "alpha-bill",
      projectId: "site",
      tokenId: "usdc.near",
      amount: "999",
      proposalId: "internal-1",
      daoAccountId: ALPHA_DAO,
    });

    const { billing } = await run(service.create(sub, { projectId: "site", proposalId: "7" }));

    expect(billing).toMatchObject({ daoAccountId: SUB_DAO, amount: "250", status: "Approved" });
    const ownerList = await run(service.list(alpha, { projectId: "site", limit: 50 }));
    expect(ownerList.data.map((b) => b.id).sort()).toEqual(["alpha-bill", billing.id].sort());
    const subList = await run(service.list(sub, { limit: 50 }));
    expect(subList.data.map((b) => b.id)).toEqual([billing.id]);
  });

  test("only the owning Agency changes the Project, its Listings and its budget", async () => {
    await subcontract();
    const { agency, budgets, listings } = services();

    await expect(
      run(agency.updateProject(sub, { id: "site", title: "Taken over" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run(
        listings.createInternal(sub, {
          projectId: "site",
          title: "Taken over",
          type: "Bounty",
          token: "USDC",
          rewardAmount: "1",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run(budgets.create(sub, { projectId: "site", tokenId: "usdc.near", amount: "5" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("each party sees only its own Engagement", async () => {
    const { engagements, prepayments, portal } = services();
    const withClient = await run(
      engagements.accept(
        acme,
        (await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }))).id,
      ),
    );
    const handedOff = await subcontract();

    expect((await run(engagements.list(acme))).data.map((e) => e.id)).toEqual([withClient.id]);
    expect((await run(engagements.list(sub))).data.map((e) => e.id)).toEqual([handedOff.id]);
    await expect(run(prepayments.list(sub, withClient.id))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await db.insert(budgets).values({
      id: "client-budget",
      projectId: "site",
      tokenId: "usdc.near",
      amount: "100",
      actorAccountId: "admin.near",
      daoAccountId: ALPHA_DAO,
    });
    expect(
      await run(portal.getBudget(sub, { engagementId: handedOff.id, projectId: "site" })),
    ).toEqual({ budgets: [] });
    const report = await run(portal.generateReport(sub, { engagementId: handedOff.id }));
    expect(report.overview).toMatchObject({ projectCount: 1, budgetByToken: [] });
  });
});
