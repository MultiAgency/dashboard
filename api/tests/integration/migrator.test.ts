import type { Migration } from "virtual:drizzle-migrations.sql";
import { sql } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseDriver, type DatabaseDriver } from "../../src/db";
import { migrate } from "../../src/db/migrate";

const probeTable: Migration = {
  idx: 0,
  when: 0,
  tag: "0000_probe",
  hash: "probe-hash-aaaa",
  sql: [`CREATE TABLE "probe" (id text PRIMARY KEY NOT NULL)`],
};

const probeInsert: Migration = {
  idx: 1,
  when: 0,
  tag: "0001_probe_seed",
  hash: "probe-hash-bbbb",
  sql: [`INSERT INTO "probe" (id) VALUES ('seed')`],
};

// PGlite cold-start dominates per-test wall time; under full-suite parallel load this can push
// past vitest's 5s default and flake. 20s gives 4-8x headroom over the observed worst case
// without masking a real hang — if any single test ever approaches 20s, something's wrong.
const TEST_TIMEOUT_MS = 20_000;

describe("migrate — runtime migrator", () => {
  let driver: DatabaseDriver;

  beforeEach(async () => {
    driver = await createDatabaseDriver("memory://");
  });

  afterEach(async () => {
    await driver.close();
  });

  test(
    "tracks applied hashes in drizzle.__drizzle_migrations, not public",
    async () => {
      await Effect.runPromise(migrate(driver.db, [probeTable]));

      const rawTracking = await driver.db.execute(
        sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`,
      );
      const hashes = (rawTracking as unknown as { rows: { hash: string }[] }).rows.map(
        (r) => r.hash,
      );
      expect(hashes).toEqual(["probe-hash-aaaa"]);

      // No legacy unqualified tracking table in public.
      const rawTables = await driver.db.execute(
        sql`SELECT schemaname FROM pg_tables WHERE tablename = 'drizzle_migrations'`,
      );
      const tables = (rawTables as unknown as { rows: { schemaname: string }[] }).rows;
      expect(tables).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "skips a migration whose hash is already applied (idempotent)",
    async () => {
      await Effect.runPromise(migrate(driver.db, [probeTable]));
      // Second call with the same migration must not re-run the CREATE TABLE.
      await Effect.runPromise(migrate(driver.db, [probeTable]));

      const rawCount = await driver.db.execute(
        sql`SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"`,
      );
      const count = (rawCount as unknown as { rows: { n: number }[] }).rows[0]?.n;
      expect(count).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "applies only new migrations on a subsequent call",
    async () => {
      await Effect.runPromise(migrate(driver.db, [probeTable]));
      await Effect.runPromise(migrate(driver.db, [probeTable, probeInsert]));

      const rawRows = await driver.db.execute(sql`SELECT id FROM "probe"`);
      const ids = (rawRows as unknown as { rows: { id: string }[] }).rows.map((r) => r.id);
      expect(ids).toEqual(["seed"]);

      const rawTracking = await driver.db.execute(
        sql`SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY id`,
      );
      const hashes = (rawTracking as unknown as { rows: { hash: string }[] }).rows.map(
        (r) => r.hash,
      );
      expect(hashes).toEqual(["probe-hash-aaaa", "probe-hash-bbbb"]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "CREATE SCHEMA IF NOT EXISTS is idempotent across multiple migrate() calls",
    async () => {
      await Effect.runPromise(migrate(driver.db, []));
      await Effect.runPromise(migrate(driver.db, []));
      const rawSchemas = await driver.db.execute(
        sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'drizzle'`,
      );
      const schemas = (rawSchemas as unknown as { rows: { schema_name: string }[] }).rows;
      expect(schemas).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
