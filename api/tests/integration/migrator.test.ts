import type { Migration } from "virtual:drizzle-migrations.sql";
import { sql } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseDriver, type DatabaseDriver } from "../../src/db";
import { loadMigrations, migrate } from "../../src/db/migrate";

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

describe("migrate — runtime migrator", () => {
  let driver: DatabaseDriver;

  beforeEach(async () => {
    driver = await createDatabaseDriver(":memory:");
  });

  afterEach(async () => {
    await driver.close();
  });

  test("tracks applied hashes in drizzle.__drizzle_migrations, not public", async () => {
    await Effect.runPromise(migrate(driver.db, [probeTable]));

    const rawTracking = await driver.db.execute(
      sql`SELECT hash FROM "drizzle"."__drizzle_migrations"`,
    );
    const hashes = (rawTracking as unknown as { rows: { hash: string }[] }).rows.map((r) => r.hash);
    expect(hashes).toEqual(["probe-hash-aaaa"]);

    const rawTables = await driver.db.execute(
      sql`SELECT schemaname FROM pg_tables WHERE tablename = 'drizzle_migrations'`,
    );
    const tables = (rawTables as unknown as { rows: { schemaname: string }[] }).rows;
    expect(tables).toEqual([]);
  });

  test("skips a migration whose hash is already applied (idempotent)", async () => {
    await Effect.runPromise(migrate(driver.db, [probeTable]));
    await Effect.runPromise(migrate(driver.db, [probeTable]));

    const rawCount = await driver.db.execute(
      sql`SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"`,
    );
    const count = (rawCount as unknown as { rows: { n: number }[] }).rows[0]?.n;
    expect(count).toBe(1);
  });

  test("applies only new migrations on a subsequent call", async () => {
    await Effect.runPromise(migrate(driver.db, [probeTable]));
    await Effect.runPromise(migrate(driver.db, [probeTable, probeInsert]));

    const rawRows = await driver.db.execute(sql`SELECT id FROM "probe"`);
    const ids = (rawRows as unknown as { rows: { id: string }[] }).rows.map((r) => r.id);
    expect(ids).toEqual(["seed"]);

    const rawTracking = await driver.db.execute(
      sql`SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY id`,
    );
    const hashes = (rawTracking as unknown as { rows: { hash: string }[] }).rows.map((r) => r.hash);
    expect(hashes).toEqual(["probe-hash-aaaa", "probe-hash-bbbb"]);
  });

  test("CREATE SCHEMA IF NOT EXISTS is idempotent across multiple migrate() calls", async () => {
    await Effect.runPromise(migrate(driver.db, []));
    await Effect.runPromise(migrate(driver.db, []));
    const rawSchemas = await driver.db.execute(
      sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'drizzle'`,
    );
    const schemas = (rawSchemas as unknown as { rows: { schema_name: string }[] }).rows;
    expect(schemas).toHaveLength(1);
  });

  test("the organization_daos migration upgrades existing data and allows one Organization per Agency DAO", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    const before = migrations.filter((m) => m.tag < "0005");
    await Effect.runPromise(migrate(driver.db, before));
    await driver.db.execute(
      sql`INSERT INTO clients (id, org_id, agency_dao_account_id, name) VALUES ('nf', 'nf-org', 'multiagency.sputnik-dao.near', 'NEAR Foundation')`,
    );

    await Effect.runPromise(migrate(driver.db, migrations));

    await driver.db.execute(
      sql`INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ('multiagency', 'multiagency.sputnik-dao.near')`,
    );
    await expect(
      driver.db.execute(
        sql`INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ('test-copy', 'multiagency.sputnik-dao.near')`,
      ),
    ).rejects.toThrow();
    const rawClients = await driver.db.execute(sql`SELECT id FROM clients`);
    expect((rawClients as unknown as { rows: { id: string }[] }).rows).toEqual([{ id: "nf" }]);
  });
  test("the settings migration re-keys settings from the Agency DAO to its Organization", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    await Effect.runPromise(
      migrate(
        driver.db,
        migrations.filter((m) => m.tag < "0006"),
      ),
    );
    await driver.db.execute(
      sql`INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ('multiagency', 'multiagency.sputnik-dao.near')`,
    );
    await driver.db.execute(
      sql`INSERT INTO settings (org_account_id, nearn_account_id, created_by, updated_by) VALUES ('multiagency.sputnik-dao.near', 'multiagency', 'admin.near', 'admin.near'), ('unmapped.sputnik-dao.near', 'unmapped', 'admin.near', 'admin.near')`,
    );

    await Effect.runPromise(migrate(driver.db, migrations));

    const raw = await driver.db.execute(
      sql`SELECT org_account_id, dao_account_id, nearn_account_id FROM settings ORDER BY nearn_account_id`,
    );
    expect((raw as unknown as { rows: unknown[] }).rows).toEqual([
      {
        org_account_id: "multiagency",
        dao_account_id: "multiagency.sputnik-dao.near",
        nearn_account_id: "multiagency",
      },
      {
        org_account_id: "unmapped.sputnik-dao.near",
        dao_account_id: null,
        nearn_account_id: "unmapped",
      },
    ]);
  });

  test("the engagements migration keeps budgets and enforces one active and one pending Engagement per pair", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    await Effect.runPromise(
      migrate(
        driver.db,
        migrations.filter((m) => m.tag < "0007"),
      ),
    );
    await driver.db.execute(
      sql`INSERT INTO budgets (id, project_id, token_id, amount, actor_account_id) VALUES ('b1', 'p1', 'near', '10', 'admin.near')`,
    );

    await Effect.runPromise(migrate(driver.db, migrations));

    const raw = await driver.db.execute(sql`SELECT id, engagement_id FROM budgets`);
    expect((raw as unknown as { rows: unknown[] }).rows).toEqual([
      { id: "b1", engagement_id: null },
    ]);
    const insert = (id: string, agency: string, client: string, status: string) =>
      driver.db.execute(
        sql`INSERT INTO engagements (id, agency_organization_id, client_organization_id, status, proposed_by) VALUES (${id}, ${agency}, ${client}, ${status}, 'admin')`,
      );
    await insert("e1", "agency", "client", "active");
    await insert("e2", "agency", "client", "proposed");
    await insert("e3", "agency", "client", "ended");
    await insert("e4", "client", "agency", "active");
    await expect(insert("e5", "agency", "client", "active")).rejects.toThrow();
    await expect(insert("e6", "agency", "client", "proposed")).rejects.toThrow();
    await expect(insert("e7", "agency", "agency", "proposed")).rejects.toThrow();
    await expect(insert("e8", "agency", "other", "paused")).rejects.toThrow();
  });
});
