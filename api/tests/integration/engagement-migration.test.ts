import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import {
  budgets,
  clientProjects,
  clients,
  engagementProjects,
  engagements,
  projectContributors,
} from "../../src/db/schema";
import { createEngagementMigration } from "../../src/services/engagement-migration";
import { inMemoryOrganizations, seedAgencyDaos } from "../fakes/organizations";
import { applyAllMigrations } from "./_pg";

const MULTIAGENCY_DAO = "multiagency.sputnik-dao.near";

describe("migrating Clients to Engagements", () => {
  let pg: PGlite;
  let db: Database;
  let world: ReturnType<typeof inMemoryOrganizations>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    const organizations = [
      { id: "multiagency", name: "MultiAgency", daoAccountId: MULTIAGENCY_DAO },
      { id: "near-foundation", name: "NEAR Foundation" },
    ];
    await seedAgencyDaos(db, organizations);
    world = inMemoryOrganizations({
      organizations,
      members: [
        { userId: "agenticweb", organizationId: "multiagency", role: "owner" },
        { userId: "agenticweb", organizationId: "near-foundation", role: "owner" },
        { userId: "efiz", organizationId: "multiagency", role: "member" },
      ],
      users: [
        { id: "agenticweb", email: "agenticweb.near@near.email", nearAccountId: "agenticweb.near" },
        { id: "efiz", email: "work.efiz.near@near.email", nearAccountId: "work.efiz.near" },
      ],
    });
    await db.insert(clients).values([
      {
        id: "nf",
        orgId: "near-foundation",
        agencyDaoAccountId: MULTIAGENCY_DAO,
        name: "NEAR Foundation",
        nearAccountId: "work.efiz.near",
      },
      {
        id: "unmapped",
        orgId: "someone",
        agencyDaoAccountId: "unmapped.sputnik-dao.near",
        name: "Unmapped",
      },
    ]);
    await db.insert(clientProjects).values([
      { clientId: "nf", projectId: "p1" },
      { clientId: "nf", projectId: "p2" },
    ]);
    await db.insert(budgets).values([
      {
        id: "attributed",
        projectId: "p1",
        tokenId: "near",
        amount: "100",
        actorAccountId: "admin.near",
        clientId: "nf",
      },
      {
        id: "unattributed",
        projectId: "p1",
        tokenId: "near",
        amount: "5",
        actorAccountId: "admin.near",
      },
    ]);
    await db.insert(projectContributors).values([
      { projectId: "p1", nearAccount: "dev.near" },
      { projectId: "gone", nearAccount: "dev.near" },
    ]);
  });

  afterEach(async () => {
    await pg.close();
  });

  function migration() {
    return createEngagementMigration({
      db,
      members: world.members,
      projectOrganizations: async (ids) =>
        new Map(ids.filter((id) => id !== "gone").map((id) => [id, "multiagency"])),
    });
  }

  test("NEAR Foundation becomes an active Client with its Projects shared and its wallet user as owner", async () => {
    const report = await migration().run();

    const [nf] = await db.select().from(engagements);
    expect(nf).toMatchObject({
      agencyOrganizationId: "multiagency",
      clientOrganizationId: "near-foundation",
      status: "active",
      kind: "client",
    });
    const shared = await db
      .select({ projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .where(eq(engagementProjects.engagementId, nf!.id));
    expect(shared.map((s) => s.projectId).sort()).toEqual(["p1", "p2"]);
    const repointed = await db.select().from(budgets).orderBy(budgets.id);
    expect(repointed.map((b) => [b.id, b.engagementId, b.clientId])).toEqual([
      ["attributed", nf!.id, "nf"],
      ["unattributed", null, null],
    ]);

    expect(world.roleOf("efiz", "near-foundation")).toBe("owner");
    expect(world.roleOf("agenticweb", "near-foundation")).toBeNull();
    expect(world.roleOf("agenticweb", "multiagency")).toBe("owner");
    expect(report.handovers).toEqual([
      expect.objectContaining({
        organizationId: "near-foundation",
        ownerUserId: "efiz",
        ownerAction: "added",
        removedUserIds: ["agenticweb"],
      }),
    ]);
    expect(report.clients.find((c) => c.clientId === "unmapped")).toMatchObject({
      action: "skipped",
      reason: "UNMAPPED_AGENCY_DAO",
    });
    const assignments = await db
      .select()
      .from(projectContributors)
      .orderBy(projectContributors.projectId);
    expect(assignments.map((a) => [a.projectId, a.organizationId])).toEqual([
      ["gone", null],
      ["p1", "multiagency"],
    ]);
  });

  test("a dry run changes nothing and a second run is a no-op", async () => {
    const dry = await migration().run({ dryRun: true });
    expect(dry.clients.find((c) => c.clientId === "nf")).toMatchObject({
      action: "created",
      sharedProjects: 2,
      repointedBudgets: 1,
    });
    expect(await db.select().from(engagements)).toEqual([]);
    expect(world.roleOf("agenticweb", "near-foundation")).toBe("owner");

    await migration().run();
    const again = await migration().run();

    expect(await db.select().from(engagements)).toHaveLength(1);
    expect(again.clients.find((c) => c.clientId === "nf")).toMatchObject({
      action: "existing",
      sharedProjects: 0,
      repointedBudgets: 0,
    });
    expect(again.handovers[0]).toMatchObject({ ownerAction: "already-owner", removedUserIds: [] });
    expect(again.assignmentsWithOrganization).toBe(0);
  });
});
