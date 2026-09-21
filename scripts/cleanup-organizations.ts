/**
 * One-time cleanup before Organizations own their Agency DAO (issue #49).
 *
 * - Deletes Organizations that share an Agency DAO with an older Organization.
 * - Removes Client-Project links to Projects that no longer exist.
 *
 * Dry run by default. Pass --apply to write. The oldest Organization keeps each
 * DAO unless one is named with --keep=<slug> (e.g. --keep=multiagency).
 *
 * Production order:
 *   1. bun scripts/cleanup-organizations.ts --keep=multiagency           (review the plan)
 *   2. bun scripts/cleanup-organizations.ts --keep=multiagency --apply
 *   3. deploy the API (0005_organization_daos enforces one Organization per DAO)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const apply = process.argv.includes("--apply");
const keep = new Set(
  process.argv.filter((a) => a.startsWith("--keep=")).map((a) => a.slice("--keep=".length)),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

type OrgRow = { id: string; name: string; slug: string; metadata: string | null; createdAt: Date };

function daoOf(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { daoAccountId?: unknown };
    return typeof parsed.daoAccountId === "string" && parsed.daoAccountId
      ? parsed.daoAccountId
      : null;
  } catch {
    return null;
  }
}

async function duplicateDaoOrganizations(auth: pg.Pool): Promise<OrgRow[]> {
  const { rows } = await auth.query<OrgRow>(
    `SELECT id, name, slug, metadata, "createdAt" FROM "organization" ORDER BY "createdAt" ASC`,
  );
  const ordered = [
    ...rows.filter((r) => keep.has(r.slug)),
    ...rows.filter((r) => !keep.has(r.slug)),
  ];
  const owner = new Map<string, OrgRow>();
  const duplicates: OrgRow[] = [];
  for (const row of ordered) {
    const dao = daoOf(row.metadata);
    if (!dao) continue;
    const kept = owner.get(dao);
    if (kept) {
      console.log(`  ${row.slug} (${row.id}) shares ${dao} with ${kept.slug}: delete`);
      duplicates.push(row);
    } else {
      owner.set(dao, row);
      console.log(`  ${row.slug} (${row.id}) keeps ${dao}`);
    }
  }
  return duplicates;
}

async function deleteOrganizations(auth: pg.Pool, ids: string[]): Promise<void> {
  const client = await auth.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM "invitation" WHERE "organizationId" = ANY($1)`, [ids]);
    await client.query(`DELETE FROM "member" WHERE "organizationId" = ANY($1)`, [ids]);
    await client.query(
      `UPDATE "session" SET "activeOrganizationId" = NULL WHERE "activeOrganizationId" = ANY($1)`,
      [ids],
    );
    await client.query(`DELETE FROM "organization" WHERE id = ANY($1)`, [ids]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function danglingProjectLinks(api: pg.Pool, projects: pg.Pool) {
  const { rows: links } = await api.query<{ client_id: string; project_id: string }>(
    "SELECT client_id, project_id FROM client_projects",
  );
  if (links.length === 0) return [];
  const { rows: existing } = await projects.query<{ id: string }>(
    "SELECT id FROM projects WHERE id = ANY($1)",
    [links.map((l) => l.project_id)],
  );
  const alive = new Set(existing.map((r) => r.id));
  const dangling = links.filter((l) => !alive.has(l.project_id));
  for (const link of dangling) {
    console.log(`  client ${link.client_id} -> missing project ${link.project_id}: delete`);
  }
  return dangling;
}

async function main() {
  const auth = new pg.Pool({ connectionString: requireEnv("AUTH_DATABASE_URL") });
  const api = new pg.Pool({ connectionString: requireEnv("API_DATABASE_URL") });
  const projects = new pg.Pool({ connectionString: requireEnv("PROJECTS_DATABASE_URL") });

  try {
    console.log("Organizations by Agency DAO:");
    const duplicates = await duplicateDaoOrganizations(auth);

    console.log("Client-Project links:");
    const dangling = await danglingProjectLinks(api, projects);

    if (!apply) {
      console.log(
        `\nDry run: ${duplicates.length} Organizations and ${dangling.length} links would be deleted. Re-run with --apply.`,
      );
      return;
    }

    if (duplicates.length > 0)
      await deleteOrganizations(
        auth,
        duplicates.map((o) => o.id),
      );
    for (const link of dangling) {
      await api.query("DELETE FROM client_projects WHERE client_id = $1 AND project_id = $2", [
        link.client_id,
        link.project_id,
      ]);
    }
    console.log(`\nDeleted ${duplicates.length} Organizations and ${dangling.length} links.`);
  } finally {
    await Promise.all([auth.end(), api.end(), projects.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
