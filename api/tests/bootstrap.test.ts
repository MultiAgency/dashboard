import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { agencySettings } from "../src/db/schema";
import { claimDaoConfig } from "../src/index";

const PLACEHOLDER_DAO = "multiagency.sputnik-dao.near";
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../src/db/migrations");
const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith(".sql"))!;
const MIGRATION = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

async function applyMigration(pg: any) {
  for (const stmt of MIGRATION.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await pg.query(trimmed);
  }
}

describe("claimDaoConfig — bootstrap DAO claim handler", () => {
  let pg: any;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite(`:memory:${crypto.randomUUID()}`);
    await applyMigration(pg);
    db = drizzle(pg);
    await db.insert(agencySettings).values({
      id: "default",
      daoAccountId: PLACEHOLDER_DAO,
    });
  });

  afterEach(async () => {
    await pg.close();
  });

  test("rejects with BAD_REQUEST when row is already configured", async () => {
    await db
      .update(agencySettings)
      .set({ daoAccountId: "already.sputnik-dao.near" })
      .where(eq(agencySettings.id, "default"));

    await expect(
      claimDaoConfig({
        db: db as never,
        nearAccountId: "alice.near",
        input: { daoAccountId: "agency.sputnik-dao.near" },
        isAdmin: async () => true,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Agency is already configured.",
    });
  });

  test("rejects with FORBIDDEN when caller is not admin on the destination DAO", async () => {
    await expect(
      claimDaoConfig({
        db: db as never,
        nearAccountId: "alice.near",
        input: { daoAccountId: "agency.sputnik-dao.near" },
        isAdmin: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not a Admin on agency.sputnik-dao.near.",
    });
  });

  test("writes the DAO account and returns { ok: true } on success", async () => {
    const result = await claimDaoConfig({
      db: db as never,
      nearAccountId: "alice.near",
      input: { daoAccountId: "agency.sputnik-dao.near" },
      isAdmin: async () => true,
    });

    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(agencySettings).where(eq(agencySettings.id, "default"));
    expect(row!.daoAccountId).toBe("agency.sputnik-dao.near");
  });

  test("passes daoAccountId, nearAccountId, and effective role to the admin probe", async () => {
    const calls: Array<[string, string, string]> = [];
    const isAdmin = async (dao: string, account: string, role: string) => {
      calls.push([dao, account, role]);
      return true;
    };

    await claimDaoConfig({
      db: db as never,
      nearAccountId: "alice.near",
      input: { daoAccountId: "agency.sputnik-dao.near" },
      isAdmin,
    });
    expect(calls[0]).toEqual(["agency.sputnik-dao.near", "alice.near", "Admin"]);

    await db
      .update(agencySettings)
      .set({ daoAccountId: PLACEHOLDER_DAO })
      .where(eq(agencySettings.id, "default"));

    await claimDaoConfig({
      db: db as never,
      nearAccountId: "alice.near",
      input: { daoAccountId: "agency.sputnik-dao.near", adminRoleName: "council" },
      isAdmin,
    });
    expect(calls[1]).toEqual(["agency.sputnik-dao.near", "alice.near", "council"]);
  });

  test("persists adminRoleName override only when it differs from the default", async () => {
    await claimDaoConfig({
      db: db as never,
      nearAccountId: "alice.near",
      input: { daoAccountId: "first.sputnik-dao.near", adminRoleName: "council" },
      isAdmin: async () => true,
    });
    const [overridden] = await db
      .select()
      .from(agencySettings)
      .where(eq(agencySettings.id, "default"));
    expect(overridden!.adminRoleName).toBe("council");

    await db
      .update(agencySettings)
      .set({ daoAccountId: PLACEHOLDER_DAO, adminRoleName: "Admin" })
      .where(eq(agencySettings.id, "default"));

    await claimDaoConfig({
      db: db as never,
      nearAccountId: "alice.near",
      input: { daoAccountId: "second.sputnik-dao.near", adminRoleName: "Admin" },
      isAdmin: async () => true,
    });
    const [defaulted] = await db
      .select()
      .from(agencySettings)
      .where(eq(agencySettings.id, "default"));
    expect(defaulted!.adminRoleName).toBe("Admin");
  });
});
