import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets, settings } from "../../src/db/schema";
import type { SqlClient } from "../../src/lib/auth-database";
import { createProjectOwnershipMigration } from "../../src/services/project-ownership";
import { seedAgencyDaos } from "../fakes/organizations";
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
    await seedAgencyDaos(db, [{ id: "multiagency", daoAccountId: MULTIAGENCY_DAO }]);
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

  test("moves Projects and settings from a mapped Agency DAO to its Organization, keeping owners", async () => {
    const report = await migration().run();

    expect(report).toEqual({
      movedProjects: [
        { daoAccountId: MULTIAGENCY_DAO, organizationId: "multiagency", projectIds: ["p1", "p2"] },
      ],
      rekeyedSettings: [{ daoAccountId: MULTIAGENCY_DAO, organizationId: "multiagency" }],
    });
    expect(await owners()).toEqual([
      { id: "p1", owner_id: "creator.near", organization_id: "multiagency" },
      { id: "p2", owner_id: MULTIAGENCY_DAO, organization_id: "multiagency" },
      { id: "p3", owner_id: "other.near", organization_id: "unmapped.sputnik-dao.near" },
      { id: "p4", owner_id: "solo.near", organization_id: null },
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

    expect(report).toEqual({ movedProjects: [], rekeyedSettings: [], fundedBudgets: [] });
    expect(await owners()).toEqual(after);
  });

  test("records the funding Agency DAO of Budget entries on the DAO's Projects, before or after the move", async () => {
    const entry = (id: string, projectId: string, fundingDaoAccountId: string | null = null) => ({
      id,
      projectId,
      tokenId: "near",
      amount: "10",
      actorAccountId: "admin.near",
      fundingDaoAccountId,
    });
    await db
      .insert(budgets)
      .values([
        entry("b1", "p1"),
        entry("b2", "p2"),
        entry("b3", "p2", "other.sputnik-dao.near"),
        entry("b4", "p3"),
      ]);
    await projectsPg.query("UPDATE projects SET organization_id = 'multiagency' WHERE id = 'p2'");

    const dry = await migration().run({ dryRun: true });
    expect(dry.fundedBudgets).toEqual([{ daoAccountId: MULTIAGENCY_DAO, budgetIds: ["b1", "b2"] }]);
    expect(
      (await db.select().from(budgets)).filter((b) => b.fundingDaoAccountId === null),
    ).toHaveLength(3);

    await migration().run();

    const funding = Object.fromEntries(
      (await db.select().from(budgets)).map((b) => [b.id, b.fundingDaoAccountId]),
    );
    expect(funding).toEqual({
      b1: MULTIAGENCY_DAO,
      b2: MULTIAGENCY_DAO,
      b3: "other.sputnik-dao.near",
      b4: null,
    });
    expect((await migration().run()).fundedBudgets).toEqual([]);
  });
});
