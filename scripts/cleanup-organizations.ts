/**
 * One-time cleanup as Organizations take over from DAO accounts (issues #49, #42).
 *
 * - Deletes Organizations that share an Agency DAO with an older Organization.
 * - Removes Client-Project links to Projects that no longer exist.
 * - Moves Projects owned by a DAO account to the Organization holding that DAO.
 * - Records each Organization's Agency DAO in the API's organization_daos registry.
 *
 * Dry run by default. Pass --apply to write. The oldest Organization keeps each
 * DAO unless one is named with --keep=<slug> (e.g. --keep=multiagency).
 *
 * Production order:
 *   1. deploy the API (creates organization_daos; the API keeps reading
 *      DAO-owned Projects until they are moved)
 *   2. bun scripts/cleanup-organizations.ts --keep=multiagency           (review the plan)
 *   3. bun scripts/cleanup-organizations.ts --keep=multiagency --apply
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

async function organizationsByDao(
  auth: pg.Pool,
): Promise<{ owners: Map<string, OrgRow>; duplicates: OrgRow[] }> {
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
  return { owners: owner, duplicates };
}

async function daoOwnedProjects(projects: pg.Pool, owners: Map<string, OrgRow>) {
  const moves: Array<{ dao: string; organizationId: string; count: number }> = [];
  for (const [dao, org] of owners) {
    const { rows } = await projects.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM projects WHERE organization_id = $1",
      [dao],
    );
    const count = rows[0]?.n ?? 0;
    if (count > 0) console.log(`  ${count} Projects owned by ${dao} -> ${org.slug} (${org.id})`);
    moves.push({ dao, organizationId: org.id, count });
  }
  return moves;
}

async function registryExists(api: pg.Pool): Promise<boolean> {
  const { rows } = await api.query<{ exists: boolean }>(
    "SELECT to_regclass('public.organization_daos') IS NOT NULL AS exists",
  );
  return rows[0]?.exists ?? false;
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
    const { owners, duplicates } = await organizationsByDao(auth);

    console.log("Client-Project links:");
    const dangling = await danglingProjectLinks(api, projects);

    console.log("Project owners:");
    const moves = await daoOwnedProjects(projects, owners);
    const moved = moves.reduce((sum, m) => sum + m.count, 0);

    const hasRegistry = await registryExists(api);
    if (!hasRegistry) console.log("organization_daos does not exist yet: deploy the API first.");

    if (!apply) {
      console.log(
        `\nDry run: ${duplicates.length} Organizations and ${dangling.length} links would be deleted, ${moved} Projects moved. Re-run with --apply.`,
      );
      return;
    }
    if (!hasRegistry) throw new Error("Deploy the API before applying.");

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
    for (const move of moves) {
      await api.query(
        "DELETE FROM organization_daos WHERE dao_account_id = $1 AND organization_id <> $2",
        [move.dao, move.organizationId],
      );
      await api.query(
        `INSERT INTO organization_daos (organization_id, dao_account_id) VALUES ($1, $2)
         ON CONFLICT (organization_id) DO UPDATE SET dao_account_id = EXCLUDED.dao_account_id`,
        [move.organizationId, move.dao],
      );
      if (move.count > 0) {
        await projects.query(
          "UPDATE projects SET organization_id = $1 WHERE organization_id = $2",
          [move.organizationId, move.dao],
        );
      }
    }
    console.log(
      `\nDeleted ${duplicates.length} Organizations and ${dangling.length} links, moved ${moved} Projects.`,
    );
  } finally {
    await Promise.all([auth.end(), api.end(), projects.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
