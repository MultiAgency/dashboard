import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Migration } from "virtual:drizzle-migrations.sql";
import { sql } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDatabaseDriver, type DatabaseDriver } from "../../src/db";
import { detectDrift, loadMigrations, migrate } from "../../src/db/migrate";

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

const migrationsDir = resolve(import.meta.dirname, "../../src/db/migrations");

function splitSQL(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n\t?/g)
    .map((line) => line.replace(/^--.*$/g, ""))
    .map((line) => line.replace("--> statement-breakpoint", ""))
    .map((line) => line.trim())
    .join(" ")
    .replaceAll(";", ";\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeStatement(statement: string) {
  return statement.replace(/\s+/g, " ").trim().replace(/;$/, "").trim();
}

function splitOnBreakpoints(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join(" "),
    )
    .map(normalizeStatement)
    .filter(Boolean);
}

describe("migration files", () => {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as {
    entries: { tag: string }[];
  };

  test.each(
    journal.entries.map((entry) => entry.tag),
  )("%s splits into the same statements under the production loader", (tag) => {
    const raw = readFileSync(join(migrationsDir, `${tag}.sql`), "utf8");
    expect(splitSQL(raw).map(normalizeStatement)).toEqual(splitOnBreakpoints(raw));
  });
});

describe("migrate — runtime migrator", () => {
  let driver: DatabaseDriver;

  beforeEach(async () => {
    driver = await createDatabaseDriver(":memory:");
  });

  afterEach(async () => {
    await driver.close();
  });

  const migrateBefore = async (tag: string) => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    await Effect.runPromise(
      migrate(
        driver.db,
        migrations.filter((m) => m.tag < tag),
      ),
    );
    return migrations;
  };

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

  test("a fully migrated database reports no drift, even for tables a later migration dropped", async () => {
    const { migrations } = await Effect.runPromise(loadMigrations());
    await Effect.runPromise(migrate(driver.db, migrations));

    const drift = await Effect.runPromise(detectDrift(driver.db, migrations));

    expect(drift).toMatchObject({ status: "healthy", missingTables: [] });
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
    await migrateBefore("0005");
    await driver.db.execute(
      sql`INSERT INTO clients (id, org_id, agency_dao_account_id, name) VALUES ('nf', 'nf-org', 'multiagency.sputnik-dao.near', 'NEAR Foundation')`,
    );

    await migrateBefore("0013");

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
    const migrations = await migrateBefore("0006");
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
    const migrations = await migrateBefore("0007");
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

  test("the prepayments migration records the funding Agency DAO of attributed Budget entries", async () => {
    await migrateBefore("0008");
    await driver.db.execute(
      sql`INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ('studio', 'studio.sputnik-dao.near')`,
    );
    await driver.db.execute(
      sql`INSERT INTO clients (id, org_id, agency_dao_account_id, name) VALUES ('legacy', 'acme', 'legacy.sputnik-dao.near', 'Acme')`,
    );
    await driver.db.execute(
      sql`INSERT INTO engagements (id, agency_organization_id, client_organization_id, status, proposed_by) VALUES ('e1', 'studio', 'acme', 'active', 'admin')`,
    );
    await driver.db.execute(
      sql`INSERT INTO budgets (id, project_id, token_id, amount, actor_account_id, engagement_id, client_id) VALUES ('by-engagement', 'p1', 'near', '10', 'admin.near', 'e1', NULL), ('by-client', 'p1', 'near', '5', 'admin.near', NULL, 'legacy'), ('own', 'p1', 'near', '1', 'admin.near', NULL, NULL)`,
    );

    await migrateBefore("0013");

    const raw = await driver.db.execute(
      sql`SELECT id, funding_dao_account_id FROM budgets ORDER BY id`,
    );
    expect((raw as unknown as { rows: unknown[] }).rows).toEqual([
      { id: "by-client", funding_dao_account_id: "legacy.sputnik-dao.near" },
      { id: "by-engagement", funding_dao_account_id: "studio.sputnik-dao.near" },
      { id: "own", funding_dao_account_id: null },
    ]);
    const insert = (period: string, amount: string) =>
      driver.db.execute(
        sql`INSERT INTO prepayments (id, engagement_id, dao_account_id, token_id, amount, period, actor_account_id) VALUES (${crypto.randomUUID()}, 'e1', 'studio.sputnik-dao.near', 'near', ${amount}, ${period}, 'admin.near')`,
      );
    await insert("2026-09", "100");
    await expect(insert("2026-9", "100")).rejects.toThrow();
    await expect(insert("2026-10", "0")).rejects.toThrow();
  });
  test("the subcontracting migration records the paying Agency DAO, makes proposal ids unique per DAO and drops the billings client column", async () => {
    await migrateBefore("0010");
    await driver.db.execute(
      sql`INSERT INTO clients (id, org_id, agency_dao_account_id, name) VALUES ('legacy', 'acme', 'legacy.sputnik-dao.near', 'Acme')`,
    );
    await driver.db.execute(
      sql`INSERT INTO budgets (id, project_id, token_id, amount, actor_account_id, funding_dao_account_id) VALUES ('funded', 'p1', 'near', '10', 'admin.near', 'studio.sputnik-dao.near'), ('mixed-a', 'p3', 'near', '1', 'admin.near', 'a.sputnik-dao.near'), ('mixed-b', 'p3', 'near', '1', 'admin.near', 'b.sputnik-dao.near')`,
    );
    await driver.db.execute(
      sql`INSERT INTO billings (id, project_id, token_id, amount, proposal_id, client_id) VALUES ('by-client', 'p2', 'near', '1', '1', 'legacy'), ('by-budget', 'p1', 'near', '1', '2', NULL), ('ambiguous', 'p3', 'near', '1', '3', NULL), ('unknown', 'p4', 'near', '1', '4', NULL)`,
    );
    await driver.db.execute(
      sql`INSERT INTO project_contributors (project_id, near_account, organization_id) VALUES ('p1', 'dev.near', 'studio')`,
    );

    await migrateBefore("0013");

    const paying = await driver.db.execute(
      sql`SELECT id, paying_dao_account_id FROM billings ORDER BY id`,
    );
    expect((paying as unknown as { rows: unknown[] }).rows).toEqual([
      { id: "ambiguous", paying_dao_account_id: null },
      { id: "by-budget", paying_dao_account_id: "studio.sputnik-dao.near" },
      { id: "by-client", paying_dao_account_id: "legacy.sputnik-dao.near" },
      { id: "unknown", paying_dao_account_id: null },
    ]);
    const assigned = await driver.db.execute(
      sql`SELECT assigned_by_organization_id FROM project_contributors`,
    );
    expect((assigned as unknown as { rows: unknown[] }).rows).toEqual([
      { assigned_by_organization_id: "studio" },
    ]);
    const insert = (id: string, dao: string) =>
      driver.db.execute(
        sql`INSERT INTO billings (id, project_id, token_id, amount, proposal_id, paying_dao_account_id) VALUES (${id}, 'p9', 'near', '1', '77', ${dao})`,
      );
    await insert("first", "studio.sputnik-dao.near");
    await insert("other-dao", "crew.sputnik-dao.near");
    await expect(insert("again", "studio.sputnik-dao.near")).rejects.toThrow();
    const clientColumn = await driver.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'billings' AND column_name = 'client_id'`,
    );
    expect((clientColumn as unknown as { rows: unknown[] }).rows).toEqual([]);
  });

  describe("dropping the legacy Client model", () => {
    const seedClient = async (clientOrganizationId: string, shared: boolean) => {
      const migrations = await migrateBefore("0013");
      await driver.db.execute(
        sql`INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ('studio', 'studio.sputnik-dao.near')`,
      );
      await driver.db.execute(
        sql`INSERT INTO clients (id, org_id, agency_dao_account_id, name) VALUES ('legacy', ${clientOrganizationId}, 'studio.sputnik-dao.near', 'Acme')`,
      );
      if (shared) {
        await driver.db.execute(
          sql`INSERT INTO client_projects (client_id, project_id) VALUES ('legacy', 'p1')`,
        );
        await driver.db.execute(
          sql`INSERT INTO budgets (id, project_id, token_id, amount, actor_account_id, client_id) VALUES ('b1', 'p1', 'near', '10', 'admin.near', 'legacy')`,
        );
      }
      return migrations;
    };
    type Engagement = {
      status: string;
      legacy: boolean;
      projects: boolean;
      budgets: boolean;
    };
    const engage = async ({ status, legacy, projects, budgets }: Engagement) => {
      await driver.db.execute(
        sql`INSERT INTO engagements (id, agency_organization_id, client_organization_id, status, proposed_by, legacy_client_id) VALUES ('e1', 'studio', 'acme', ${status}, 'migration', ${legacy ? "legacy" : null})`,
      );
      if (projects) {
        await driver.db.execute(
          sql`INSERT INTO engagement_projects (engagement_id, project_id) VALUES ('e1', 'p1')`,
        );
      }
      if (budgets) {
        await driver.db.execute(
          sql`UPDATE budgets SET engagement_id = 'e1' WHERE client_id = 'legacy'`,
        );
      }
    };
    const rows = async (query: ReturnType<typeof sql>) =>
      ((await driver.db.execute(query)) as unknown as { rows: unknown[] }).rows;
    const legacyLeft = () =>
      rows(
        sql`SELECT table_name AS name FROM information_schema.tables WHERE table_name IN ('clients', 'client_projects') UNION ALL SELECT column_name FROM information_schema.columns WHERE table_name = 'budgets' AND column_name = 'client_id' ORDER BY name`,
      );
    const covered = { status: "active", legacy: true, projects: true, budgets: true };

    test.each([
      ["its migrated Engagement", "acme", covered],
      ["an active Engagement of the same pair", "acme", { ...covered, legacy: false }],
      [
        "an ended Engagement of the same pair",
        "acme",
        { ...covered, legacy: false, status: "ended" },
      ],
      ["no Engagement for a self-Engagement row with nothing shared", "studio", null],
    ])("drops the legacy Client model and keeps migrated Budget entries with %s", async (_, organization, engagement) => {
      const migrations = await seedClient(organization, engagement !== null);
      if (engagement) await engage(engagement);

      await Effect.runPromise(migrate(driver.db, migrations));

      expect(await legacyLeft()).toEqual([]);
      expect(await rows(sql`SELECT id, engagement_id FROM budgets`)).toEqual(
        engagement ? [{ id: "b1", engagement_id: "e1" }] : [],
      );
    });

    test.each([
      ["a clients row has no Engagement", "acme", null],
      ["a shared Project was not copied", "acme", { ...covered, projects: false }],
      ["a Budget entry is not on its Engagement", "acme", { ...covered, budgets: false }],
      [
        "the pair's only Engagement is proposed",
        "acme",
        { ...covered, legacy: false, status: "proposed" },
      ],
      ["a self-Engagement row shares a Project", "studio", null],
    ])("refuses and keeps the tables when %s", async (_, organization, engagement) => {
      const migrations = await seedClient(organization, true);
      if (engagement) await engage(engagement);

      await expect(Effect.runPromise(migrate(driver.db, migrations))).rejects.toThrow(
        "Legacy clients are not migrated to Engagements yet",
      );

      expect(await legacyLeft()).toEqual([
        { name: "client_id" },
        { name: "client_projects" },
        { name: "clients" },
      ]);
    });
  });
});
