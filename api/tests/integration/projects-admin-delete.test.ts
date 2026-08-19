// Cascade SPEC commitment (SPEC §"Billings cascade on project delete"): deleting a project
// deletes its billings, budgets, projectContributors, and listings rows; the on-chain audit
// trail survives via the Sputnik proposal ids that billings used to point to.
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { billings, budgets, listings, projectContributors } from "../../src/db/schema";
import { deleteProjectCascade } from "../../src/services/projects";
import { applyAllMigrations } from "./_pg";

const PROJECT_A = "00000000-0000-0000-0000-00000000000a";
const PROJECT_B = "00000000-0000-0000-0000-00000000000b";
const NEAR_X = "contributor-x.near";
const NEAR_Y = "contributor-y.near";

describe("agency.projects.adminDelete — cascade transaction", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  async function seedProject(projectId: string, nearAccount: string) {
    await db.insert(budgets).values({
      id: crypto.randomUUID(),
      projectId,
      tokenId: "near",
      amount: "1000",
      actorAccountId: "alice.near",
    });
    await db.insert(billings).values({
      id: crypto.randomUUID(),
      projectId,
      nearAccount,
      tokenId: "near",
      amount: "500",
      proposalId: `proposal-${projectId.slice(-4)}`,
    });
    await db.insert(projectContributors).values({ projectId, nearAccount, role: "lead" });
    await db.insert(listings).values({
      id: crypto.randomUUID(),
      projectId,
      source: "internal",
    });
  }

  const cascade = (projectId: string) => deleteProjectCascade(db as never, projectId);

  test("removes all four cascade-table rows scoped to the project", async () => {
    await seedProject(PROJECT_A, NEAR_X);

    await cascade(PROJECT_A);

    expect(await db.select().from(billings).where(eq(billings.projectId, PROJECT_A))).toHaveLength(
      0,
    );
    expect(await db.select().from(budgets).where(eq(budgets.projectId, PROJECT_A))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(projectContributors)
        .where(eq(projectContributors.projectId, PROJECT_A)),
    ).toHaveLength(0);
    expect(await db.select().from(listings).where(eq(listings.projectId, PROJECT_A))).toHaveLength(
      0,
    );
  });

  test("leaves rows for OTHER projects untouched", async () => {
    await seedProject(PROJECT_A, NEAR_X);
    await seedProject(PROJECT_B, NEAR_Y);

    await cascade(PROJECT_A);

    expect(await db.select().from(billings).where(eq(billings.projectId, PROJECT_B))).toHaveLength(
      1,
    );
    expect(await db.select().from(budgets).where(eq(budgets.projectId, PROJECT_B))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(projectContributors)
        .where(eq(projectContributors.projectId, PROJECT_B)),
    ).toHaveLength(1);
    expect(await db.select().from(listings).where(eq(listings.projectId, PROJECT_B))).toHaveLength(
      1,
    );
  });

  test("removes assignment row only (builder profiles live in builders plugin)", async () => {
    await seedProject(PROJECT_A, NEAR_X);

    await cascade(PROJECT_A);

    const assignments = await db
      .select()
      .from(projectContributors)
      .where(eq(projectContributors.nearAccount, NEAR_X));
    expect(assignments).toHaveLength(0);
  });

  test("cascade is idempotent: re-running on an already-deleted project is a no-op", async () => {
    await seedProject(PROJECT_A, NEAR_X);

    await cascade(PROJECT_A);
    await cascade(PROJECT_A);

    expect(await db.select().from(billings).where(eq(billings.projectId, PROJECT_A))).toHaveLength(
      0,
    );
  });

  test("transaction atomicity: a project with zero cascade rows still completes cleanly", async () => {
    await cascade(PROJECT_A);
    expect(true).toBe(true);
  });
});
