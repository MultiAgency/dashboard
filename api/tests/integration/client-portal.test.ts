import { beforeEach, describe, expect, test } from "vitest";
import { billings, budgets, projectContributors } from "../../src/db/schema";
import { runEffect as run } from "../../src/lib/context";
import { clientPortalOf, engagementWorld } from "../fakes/engagements";
import { migratedDatabase } from "./_pg";

const billing = (id: string, projectId: string, amount: string, day: number) => ({
  id,
  projectId,
  nearAccount: "builder.near",
  tokenId: "near",
  amount,
  proposalId: `not-a-number-${day}`,
  createdAt: new Date(`2026-01-0${day}T00:00:00Z`),
});

describe("client portal through Engagements", () => {
  const database = migratedDatabase({ perTest: true });
  let world: Awaited<ReturnType<typeof engagementWorld>>;
  let portal: ReturnType<typeof clientPortalOf>;
  let acmeEngagement: string;
  let globexEngagement: string;

  beforeEach(async () => {
    const { db } = database;
    world = await engagementWorld(db);
    portal = clientPortalOf(db, world);
    acmeEngagement = (await world.activeEngagement("acme", ["shared"])).id;
    globexEngagement = (await world.activeEngagement("globex", ["shared"])).id;

    const entry = { tokenId: "near", actorAccountId: "admin.near" };
    await db.insert(budgets).values([
      { ...entry, id: "acme", projectId: "shared", amount: "1000", engagementId: acmeEngagement },
      { ...entry, id: "internal", projectId: "internal", amount: "5000" },
    ]);
    await db
      .insert(billings)
      .values([
        billing("billing-acme", "shared", "100", 1),
        billing("billing-unattributed", "shared", "200", 2),
        billing("billing-internal", "internal", "999", 3),
      ]);
    await db
      .insert(projectContributors)
      .values({ projectId: "shared", nearAccount: "builder.near", role: "engineer" });
  });

  const viewer = () => world.context("acme-member", "acme");

  test("a Client member without a NEAR wallet sees the private shared Project in full", async () => {
    const listed = await run(portal.listProjects(viewer(), { engagementId: acmeEngagement }));
    expect(listed.data.map((p) => [p.slug, p.visibility])).toEqual([["shared", "private"]]);

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

    for (const outsider of [globex, world.context("studio-admin", "studio")]) {
      await expect(
        run(portal.listProjects(outsider, { engagementId: acmeEngagement })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    const acmeReport = await run(portal.generateReport(viewer(), { engagementId: acmeEngagement }));
    expect(acmeReport.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);
    expect(acmeReport.overview.projectCount).toBe(1);

    const globexProjects = await run(
      portal.listProjects(globex, { engagementId: globexEngagement }),
    );
    expect(globexProjects.data.map((p) => p.id)).toEqual(["shared"]);
  });

  test("the dashboard summarises remaining budget, and an ended Engagement stays readable as history while a proposed one does not", async () => {
    expect(await run(portal.dashboardSummary(viewer(), { engagementId: acmeEngagement }))).toEqual({
      status: "active",
      readOnly: false,
      projectCount: 1,
      remainingByToken: [{ tokenId: "near", amount: "700" }],
    });

    const studio = await world.manager("studio-admin", "studio");
    await world.engagements.end(studio, acmeEngagement);

    const summary = await run(portal.dashboardSummary(viewer(), { engagementId: acmeEngagement }));
    expect(summary).toMatchObject({ status: "ended", readOnly: true, projectCount: 1 });
    expect(
      (await run(portal.listBillings(viewer(), { engagementId: acmeEngagement, limit: 50 }))).data,
    ).toHaveLength(2);

    const proposed = await world.engagements.propose(studio, { slug: "acme", name: "Acme Corp" });
    await expect(
      run(portal.listProjects(viewer(), { engagementId: proposed.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
