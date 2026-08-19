/**
 * One-time migration: copy contributors rows into the builders plugin DB.
 *
 * Production order:
 *   1. bun run db:migrate:contributors   (while contributors still exists)
 *   2. apply 0003_epic003.sql            (drops contributors)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as buildersSchema from "../plugins/builders/src/db/schema.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

type LegacyContributorRow = {
  id: string;
  near_account_id: string | null;
  name: string;
  email: string | null;
  onboarding_status: string;
};

type MigrationResult = {
  created: number;
  updated: number;
  skipped: number;
  fromContributorsTable: number;
  fromNearAccountScan: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example)`);
  return value;
}

function resolvedNearAccount(row: LegacyContributorRow): string {
  return row.near_account_id ?? row.id;
}

function bioFromLegacy(row: LegacyContributorRow): string | null {
  const parts = [
    row.email ? `Email: ${row.email}` : null,
    `Onboarding: ${row.onboarding_status}`,
    "Migrated from contributors",
  ].filter(Boolean);
  return parts.join(" · ");
}

async function contributorsTableExists(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'contributors'
    ) AS exists
  `);
  return result.rows[0]?.exists ?? false;
}

async function loadLegacyContributors(pool: pg.Pool): Promise<LegacyContributorRow[]> {
  const { rows } = await pool.query<LegacyContributorRow>(`
    SELECT id, near_account_id, name, email, onboarding_status
    FROM contributors
    ORDER BY created_at, id
  `);
  return rows;
}

async function loadDistinctNearAccounts(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ near_account: string }>(`
    SELECT DISTINCT near_account
    FROM (
      SELECT near_account FROM project_contributors
      UNION
      SELECT near_account FROM billings WHERE near_account IS NOT NULL
    ) accounts
    WHERE near_account IS NOT NULL
    ORDER BY near_account
  `);
  return rows.map((r) => r.near_account);
}

export async function migrateContributorsToBuilders(options?: {
  dryRun?: boolean;
}): Promise<MigrationResult> {
  const dryRun = options?.dryRun ?? false;
  const apiUrl = requireEnv("API_DATABASE_URL");
  const buildersUrl = requireEnv("BUILDERS_DATABASE_URL");

  const apiPool = new pg.Pool({ connectionString: apiUrl });
  const buildersPool = new pg.Pool({ connectionString: buildersUrl });
  const buildersDb = drizzle(buildersPool, { schema: buildersSchema });

  const result: MigrationResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    fromContributorsTable: 0,
    fromNearAccountScan: 0,
  };

  const pending: Array<{
    nearAccount: string;
    name: string | null;
    bio: string | null;
    source: "contributors" | "near_account_scan";
  }> = [];

  const hasContributors = await contributorsTableExists(apiPool);
  if (hasContributors) {
    const legacyRows = await loadLegacyContributors(apiPool);
    result.fromContributorsTable = legacyRows.length;
    for (const row of legacyRows) {
      pending.push({
        nearAccount: resolvedNearAccount(row),
        name: row.name,
        bio: bioFromLegacy(row),
        source: "contributors",
      });
    }
    console.log(`Found ${legacyRows.length} row(s) in contributors`);
  } else {
    console.log("contributors not present — scanning near_account references only");
  }

  const referencedNearAccounts = await loadDistinctNearAccounts(apiPool);
  const contributorNearAccounts = new Set(pending.map((p) => p.nearAccount));
  for (const nearAccount of referencedNearAccounts) {
    if (contributorNearAccounts.has(nearAccount)) continue;
    pending.push({
      nearAccount,
      name: null,
      bio: "Backfilled from project_contributors / billings near_account",
      source: "near_account_scan",
    });
    result.fromNearAccountScan += 1;
  }

  if (pending.length === 0) {
    console.log("Nothing to migrate.");
    await apiPool.end();
    await buildersPool.end();
    return result;
  }

  const existing = await buildersDb
    .select({
      nearAccount: buildersSchema.builders.nearAccount,
      name: buildersSchema.builders.name,
    })
    .from(buildersSchema.builders)
    .where(
      inArray(
        buildersSchema.builders.nearAccount,
        pending.map((p) => p.nearAccount),
      ),
    );
  const existingByNear = new Map(existing.map((b) => [b.nearAccount, b]));

  for (const item of pending) {
    const current = existingByNear.get(item.nearAccount);

    if (item.source === "near_account_scan") {
      if (current) {
        result.skipped += 1;
        continue;
      }
    } else if (current?.name && item.name && current.name === item.name) {
      result.skipped += 1;
      console.log(`  skip ${item.nearAccount} (already present)`);
      continue;
    }

    if (dryRun) {
      console.log(
        `  [dry-run] would ${current ? "update" : "create"} ${item.nearAccount} ← ${item.source}`,
      );
      if (current) result.updated += 1;
      else result.created += 1;
      continue;
    }

    if (current) {
      await buildersDb
        .update(buildersSchema.builders)
        .set({
          name: item.name ?? current.name,
          bio: item.bio,
          updatedAt: sql`now()`,
        })
        .where(eq(buildersSchema.builders.nearAccount, item.nearAccount));
      result.updated += 1;
      console.log(`  update ${item.nearAccount} ← ${item.source}`);
    } else {
      await buildersDb.insert(buildersSchema.builders).values({
        id: crypto.randomUUID(),
        nearAccount: item.nearAccount,
        userId: null,
        name: item.name,
        bio: item.bio,
        skills: null,
        location: null,
        links: null,
      });
      result.created += 1;
      console.log(`  create ${item.nearAccount} ← ${item.source}`);
    }
  }

  console.log(
    `\nDone: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped` +
      (dryRun ? " (dry-run)" : ""),
  );

  await apiPool.end();
  await buildersPool.end();
  return result;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await migrateContributorsToBuilders({ dryRun });
}

const isDirectRun =
  process.argv[1]?.endsWith("migrate-contributors-to-builders.ts") ||
  process.argv[1]?.endsWith("migrate-contributors-to-builders");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
