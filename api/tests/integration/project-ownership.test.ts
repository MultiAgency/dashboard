import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { organizationDaos, settings } from "../../src/db/schema";
import {
  createProjectOwnershipMigration,
  type SqlClient,
} from "../../src/services/project-ownership";
import { applyAllMigrations, applyProjectsPluginMigrations } from "./_pg";

const MULTIAGENCY_DAO = "multiagency.sputnik-dao.near";

describe("project ownership migration", () => {
  let apiPg: PGlite;
  let projectsPg: PGlite;
  let db: Database;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    apiPg = new PGlite("memory://");
    projectsPg = new PGlite("memory://");
    await applyAllMigrations(apiPg);
    await applyProjectsPluginMigrations(projectsPg);
    db = drizzle(apiPg, { schema }) as unknown as Database;
    await db
      .insert(organizationDaos)
      .values({ organizationId: "multiagency", daoAccountId: MULTIAGENCY_DAO });
    for (const [id, owner, organization] of [
      ["p1", "creator.near", MULTIAGENCY_DAO],
      ["p2", MULTIAGENCY_DAO, MULTIAGENCY_DAO],
      ["p3", "other.near", "unmapped.sputnik-dao.near"],
      ["p4", "solo.near", null],
    ]) {
      await projectsPg.query(
        "INSERT INTO projects (id, owner_id, organization_id, slug, title) VALUES ($1, $2, $3, $4, $4)",
        [id, owner, organization, `slug-${id}`],
      );
    }
    await db.insert(settings).values({
      orgAccountId: MULTIAGENCY_DAO,
      nearnAccountId: "multiagency",
      createdBy: "admin.near",
      updatedBy: "admin.near",
    });
  });

  afterEach(async () => {
    await apiPg.close();
    await projectsPg.close();
  });

  const migration = () =>
    createProjectOwnershipMigration({ db, projectsDb: projectsPg as unknown as SqlClient });

  async function owners() {
    const { rows } = await projectsPg.query<{
      id: string;
      owner_id: string;
      organization_id: string | null;
    }>("SELECT id, owner_id, organization_id FROM projects ORDER BY id");
    return rows;
  }

  test("moves Projects from a mapped Agency DAO to its Organization and keeps their owner", async () => {
    const report = await migration().run();

    expect(report.movedProjects).toEqual([
      { daoAccountId: MULTIAGENCY_DAO, organizationId: "multiagency", projectIds: ["p1", "p2"] },
    ]);
    expect(await owners()).toEqual([
      { id: "p1", owner_id: "creator.near", organization_id: "multiagency" },
      { id: "p2", owner_id: MULTIAGENCY_DAO, organization_id: "multiagency" },
      { id: "p3", owner_id: "other.near", organization_id: "unmapped.sputnik-dao.near" },
      { id: "p4", owner_id: "solo.near", organization_id: null },
    ]);
  });

  test("re-keys the Agency DAO's settings to its Organization", async () => {
    const report = await migration().run();

    expect(report.rekeyedSettings).toEqual([
      { daoAccountId: MULTIAGENCY_DAO, organizationId: "multiagency" },
    ]);
    expect(await db.select().from(settings)).toMatchObject([
      { orgAccountId: "multiagency", daoAccountId: MULTIAGENCY_DAO, nearnAccountId: "multiagency" },
    ]);
  });

  test("a dry run reports without changing anything", async () => {
    const before = await owners();

    const report = await migration().run({ dryRun: true });

    expect(report.movedProjects).toHaveLength(1);
    expect(await owners()).toEqual(before);
    expect((await db.select().from(settings))[0]?.orgAccountId).toBe(MULTIAGENCY_DAO);
  });

  test("a second run changes nothing", async () => {
    await migration().run();
    const after = await owners();

    const report = await migration().run();

    expect(report).toEqual({ movedProjects: [], rekeyedSettings: [] });
    expect(await owners()).toEqual(after);
  });
});
