import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { billings } from "../../src/db/schema";
import { applyAllMigrations } from "./_pg";

const PROJECT_A = "00000000-0000-0000-0000-00000000000a";

describe("billings — adminDelete persistence", () => {
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

  async function insertBilling(id: string, proposalId: string) {
    await db.insert(billings).values({
      id,
      projectId: PROJECT_A,
      nearAccount: null,
      tokenId: "near",
      amount: "1000",
      proposalId,
      note: null,
      createdAt: new Date(),
    });
  }

  test("delete by id removes the row", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    await insertBilling(id, "42");
    const before = await db.select().from(billings).where(eq(billings.id, id));
    expect(before).toHaveLength(1);

    await db.delete(billings).where(eq(billings.id, id));

    const after = await db.select().from(billings).where(eq(billings.id, id));
    expect(after).toHaveLength(0);
  });

  test("delete of non-existent id is a no-op (handler emits NOT_FOUND before delete)", async () => {
    const result = await db
      .delete(billings)
      .where(eq(billings.id, "ffffffff-ffff-ffff-ffff-ffffffffffff"));
    expect(result).toBeDefined();
    const rows = await db.select().from(billings);
    expect(rows).toHaveLength(0);
  });

  test("deleting one billing leaves siblings intact", async () => {
    await insertBilling("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "1");
    await insertBilling("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "2");

    await db.delete(billings).where(eq(billings.id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));

    const rows = await db.select().from(billings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposalId).toBe("2");
  });

  test("re-creating after delete works (proposalId UNIQUE released)", async () => {
    await insertBilling("cccccccc-cccc-cccc-cccc-cccccccccccc", "99");
    await db.delete(billings).where(eq(billings.id, "cccccccc-cccc-cccc-cccc-cccccccccccc"));

    await insertBilling("dddddddd-dddd-dddd-dddd-dddddddddddd", "99");
    const rows = await db.select().from(billings).where(eq(billings.proposalId, "99"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
  });
});
