import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, budgets, projectContributors } from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createReportsService } from "../../src/services/reports";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const STUDIO_DAO = "studio.sputnik-dao.testnet";

const organizations = [
  { id: "studio", name: "Studio", slug: "studio", daoAccountId: STUDIO_DAO },
  { id: "acme", name: "Acme Corp", slug: "acme" },
  { id: "globex", name: "Globex", slug: "globex" },
];

const members = [
  { userId: "studio-admin", organizationId: "studio", role: "admin" as const },
  { userId: "acme-owner", organizationId: "acme", role: "owner" as const },
  { userId: "acme-viewer", organizationId: "acme", role: "member" as const },
  { userId: "globex-owner", organizationId: "globex", role: "owner" as const },
];

const users = members.map((m) => ({ id: m.userId, email: `${m.userId}@example.com` }));

const projects = [
  { ...project("shared", "studio"), slug: "shared", title: "Shared work" },
  { ...project("internal", "studio"), slug: "internal", title: "Internal work" },
];

const run = <A>(effect: Effect.Effect<A, unknown>) => runEffect(effect);

describe("client portal through Engagements", () => {
  let pg: PGlite;
  let db: Database;
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let portal: ReturnType<typeof createClientPortalService>;
  let acmeEngagement: string;
  let globexEngagement: string;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    world = await engagementWorld(db, { organizations, members, users, projects });
    const plugins = {
      builders: () => ({
        listBuilders: async () => ({ data: [{ nearAccount: "builder.near", name: "Builder" }] }),
      }),
    } as unknown as PluginsClient;
    const listings = createListingsService(db, world.directory);
    const ledgers = createProjectLedgers(db, listings);
    portal = createClientPortalService(
      world.access,
      createAgencyService(db, plugins, world.directory, listings, ledgers),
      createBillingsService(db, world.directory),
      createReportsService(db, world.directory, plugins, world.organizations.directory),
      world.directory,
      ledgers,
    );

    const studio = await world.manager("studio-admin", "studio");
    for (const [slug, name, owner] of [
      ["acme", "Acme Corp", "acme-owner"],
      ["globex", "Globex", "globex-owner"],
    ] as const) {
      const proposed = await world.engagements.propose(studio, { slug, name });
      await world.engagements.accept(await world.manager(owner, slug), proposed.id);
      await world.engagements.share(studio, { engagementId: proposed.id, projectId: "shared" });
      if (slug === "acme") acmeEngagement = proposed.id;
      else globexEngagement = proposed.id;
    }

    await db.insert(budgets).values([
      {
        id: "budget-acme",
        projectId: "shared",
        tokenId: "near",
        amount: "1000",
        actorAccountId: "admin.near",
        engagementId: acmeEngagement,
      },
      {
        id: "budget-internal",
        projectId: "internal",
        tokenId: "near",
        amount: "5000",
        actorAccountId: "admin.near",
      },
    ]);
    await db.insert(billings).values([
      {
        id: "billing-acme",
        projectId: "shared",
        nearAccount: "builder.near",
        tokenId: "near",
        amount: "100",
        proposalId: "not-a-number-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "billing-unattributed",
        projectId: "shared",
        nearAccount: "builder.near",
        tokenId: "near",
        amount: "200",
        proposalId: "not-a-number-2",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        id: "billing-internal",
        projectId: "internal",
        nearAccount: "builder.near",
        tokenId: "near",
        amount: "999",
        proposalId: "not-a-number-3",
        createdAt: new Date("2026-01-03T00:00:00Z"),
      },
    ]);
    await db
      .insert(projectContributors)
      .values({ projectId: "shared", nearAccount: "builder.near", role: "engineer" });
  });

  afterEach(async () => {
    await pg.close();
  });

  const viewer = () => world.context("acme-viewer", "acme");

  test("a Client member without a NEAR wallet sees the private shared Project in full", async () => {
    const listed = await run(portal.listProjects(viewer(), { engagementId: acmeEngagement }));
    expect(listed.data.map((p) => p.slug)).toEqual(["shared"]);
    expect(listed.data[0]?.visibility).toBe("private");

    const detail = await run(
      portal.getProject(viewer(), { engagementId: acmeEngagement, slug: "shared" }),
    );
    expect(detail.project.title).toBe("Shared work");
    expect(detail.contributors).toEqual([
      { nearAccount: "builder.near", name: "Builder", role: "engineer" },
    ]);

    await expect(
      run(portal.getProject(viewer(), { engagementId: acmeEngagement, slug: "internal" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a Client sees every Billing on its shared Projects, attributed or not", async () => {
    const listed = await run(
      portal.listBillings(viewer(), { engagementId: acmeEngagement, limit: 50 }),
    );

    expect(listed.data.map((b) => b.id)).toEqual(["billing-unattributed", "billing-acme"]);
    const budget = await run(
      portal.getBudget(viewer(), { engagementId: acmeEngagement, projectId: "shared" }),
    );
    expect(budget.budgets).toEqual([
      expect.objectContaining({ tokenId: "near", budget: "1000", committed: "300" }),
    ]);
  });

  test("each party sees only what flows through its own Engagement", async () => {
    const globex = world.context("globex-owner", "globex");

    await expect(
      run(portal.listProjects(globex, { engagementId: acmeEngagement })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run(
        portal.listProjects(world.context("studio-admin", "studio"), {
          engagementId: acmeEngagement,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const acmeReport = await run(portal.generateReport(viewer(), { engagementId: acmeEngagement }));
    expect(acmeReport.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);
    expect(acmeReport.overview.projectCount).toBe(1);

    const globexProjects = await run(
      portal.listProjects(globex, { engagementId: globexEngagement }),
    );
    expect(globexProjects.data.map((p) => p.id)).toEqual(["shared"]);
  });

  test("an ended Engagement stays readable as history, a declined or proposed one does not", async () => {
    await world.engagements.end(await world.manager("studio-admin", "studio"), acmeEngagement);

    const summary = await run(portal.dashboardSummary(viewer(), { engagementId: acmeEngagement }));
    expect(summary).toMatchObject({ status: "ended", readOnly: true, projectCount: 1 });
    expect(
      (await run(portal.listBillings(viewer(), { engagementId: acmeEngagement, limit: 50 }))).data,
    ).toHaveLength(2);

    const proposed = await world.engagements.propose(
      await world.manager("studio-admin", "studio"),
      {
        slug: "acme",
        name: "Acme Corp",
      },
    );
    await expect(
      run(portal.listProjects(viewer(), { engagementId: proposed.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("the Client's dashboard summarises remaining budget on its shared Projects", async () => {
    const summary = await run(portal.dashboardSummary(viewer(), { engagementId: acmeEngagement }));

    expect(summary).toEqual({
      status: "active",
      readOnly: false,
      projectCount: 1,
      remainingByToken: [{ tokenId: "near", amount: "700" }],
    });
  });
});
