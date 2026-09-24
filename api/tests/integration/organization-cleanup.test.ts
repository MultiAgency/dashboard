import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { clientProjects, clients, organizationDaos } from "../../src/db/schema";
import { createOrganizationCleanup } from "../../src/services/organization-cleanup";
import { type FakeOrganization, inMemoryOrganizations } from "../fakes/organizations";
import { applyAllMigrations } from "./_pg";

const MULTIAGENCY = "multiagency.sputnik-dao.near";
const OTHER = "other.sputnik-dao.near";

describe("organization cleanup", () => {
  let pg: PGlite;
  let db: Database;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE organization_daos, clients, client_projects CASCADE");
  });

  afterAll(async () => {
    await pg.close();
  });

  const duplicated: FakeOrganization[] = [
    { id: "test-copy", daoAccountId: MULTIAGENCY, createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "multiagency", daoAccountId: MULTIAGENCY, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "another-copy", daoAccountId: MULTIAGENCY, createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "other", daoAccountId: OTHER },
    { id: "client-org" },
    { id: "personal", daoAccountId: MULTIAGENCY, isPersonal: true },
  ];

  function cleanupWith(organizations: FakeOrganization[], existingProjects: string[] = []) {
    const fake = inMemoryOrganizations({ organizations });
    const cleanup = createOrganizationCleanup({
      db,
      organizations: fake.port,
      existingProjects: async (ids) => new Set(ids.filter((id) => existingProjects.includes(id))),
    });
    return { fake, cleanup };
  }

  async function mappings() {
    const rows = await db.select().from(organizationDaos);
    return rows.map((r) => [r.organizationId, r.daoAccountId]).sort();
  }

  async function linkClientTo(projectIds: string[]) {
    await db.insert(clients).values({
      id: "nf",
      orgId: "client-org",
      agencyDaoAccountId: MULTIAGENCY,
      name: "NEAR Foundation",
    });
    await db
      .insert(clientProjects)
      .values(projectIds.map((projectId) => ({ clientId: "nf", projectId })));
  }

  async function linkedProjects() {
    return (await db.select().from(clientProjects)).map((l) => l.projectId).sort();
  }

  test("keeps the oldest Organization of a duplicated Agency DAO and maps every Agency DAO", async () => {
    const { fake, cleanup } = cleanupWith(duplicated);

    const report = await cleanup.run();

    expect(fake.ids()).toEqual(["client-org", "multiagency", "other", "personal"]);
    expect(report.removedOrganizations.sort()).toEqual(["another-copy", "test-copy"]);
    expect(await mappings()).toEqual([
      ["multiagency", MULTIAGENCY],
      ["other", OTHER],
    ]);
  });

  test("keeps the Organization already mapped to the Agency DAO", async () => {
    await db
      .insert(organizationDaos)
      .values({ organizationId: "test-copy", daoAccountId: MULTIAGENCY });
    const { fake, cleanup } = cleanupWith(duplicated);

    await cleanup.run();

    expect(fake.ids()).toEqual(["client-org", "other", "personal", "test-copy"]);
    expect(await mappings()).toEqual([
      ["other", OTHER],
      ["test-copy", MULTIAGENCY],
    ]);
  });

  test("removes Client-Project links to deleted Projects and keeps the others", async () => {
    await linkClientTo(["alive", "deleted"]);
    const { cleanup } = cleanupWith(duplicated, ["alive"]);

    const report = await cleanup.run();

    expect(await linkedProjects()).toEqual(["alive"]);
    expect(report.removedClientProjectLinks).toEqual([{ clientId: "nf", projectId: "deleted" }]);
  });

  test("running it again changes nothing", async () => {
    await linkClientTo(["alive", "deleted"]);
    const { fake, cleanup } = cleanupWith(duplicated, ["alive"]);
    await cleanup.run();

    const second = await cleanup.run();

    expect(second).toEqual({
      removedOrganizations: [],
      mappedOrganizations: [],
      removedClientProjectLinks: [],
    });
    expect(fake.ids()).toEqual(["client-org", "multiagency", "other", "personal"]);
    expect(await linkedProjects()).toEqual(["alive"]);
  });

  test("a dry run reports the changes without making them", async () => {
    await linkClientTo(["alive", "deleted"]);
    const { fake, cleanup } = cleanupWith(duplicated, ["alive"]);

    const report = await cleanup.run({ dryRun: true });

    expect(report.removedOrganizations.sort()).toEqual(["another-copy", "test-copy"]);
    expect(report.mappedOrganizations).toHaveLength(2);
    expect(report.removedClientProjectLinks).toHaveLength(1);
    expect(fake.ids()).toHaveLength(duplicated.length);
    expect(await mappings()).toEqual([]);
    expect(await linkedProjects()).toEqual(["alive", "deleted"]);
  });
});
