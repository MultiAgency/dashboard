import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

type OrgRow = { id: string; name: string; slug: string; metadata: unknown; createdAt: Date };

function daoOf(metadata: unknown): string | null {
  if (!metadata) return null;
  try {
    const parsed = (typeof metadata === "string" ? JSON.parse(metadata) : metadata) as {
      daoAccountId?: unknown;
    };
    return typeof parsed.daoAccountId === "string" && parsed.daoAccountId
      ? parsed.daoAccountId
      : null;
  } catch {
    return null;
  }
}

async function organizationsByDao(
  auth: pg.Pool,
  keep: Set<string>,
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

async function tableExists(pool: pg.Pool, name: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${name}`],
  );
  return rows[0]?.exists ?? false;
}

async function danglingProjectLinks(api: pg.Pool, projects: pg.Pool) {
  if (!(await tableExists(api, "client_projects"))) return [];
  const { rows: links } = await api.query<{ client_id: string; project_id: string }>(
    "SELECT client_id, project_id FROM client_projects",
  );
  if (links.length === 0) return [];
  const { rows: existing } = await projects.query<{ id: string }>(
    "SELECT id FROM projects WHERE id = ANY($1)",
    [[...new Set(links.map((l) => l.project_id))]],
  );
  const alive = new Set(existing.map((r) => r.id));
  const dangling = links.filter((l) => !alive.has(l.project_id));
  for (const link of dangling) {
    console.log(`  client ${link.client_id} -> missing project ${link.project_id}: delete`);
  }
  return dangling;
}

type Handover = {
  clientOrganizationId: string;
  clientName: string;
  ownerUserId: string | null;
  nearAccountId: string;
  staffUserIds: string[];
};

async function clientHandovers(
  auth: pg.Pool,
  api: pg.Pool,
  owners: Map<string, OrgRow>,
): Promise<Handover[]> {
  if (!(await tableExists(api, "clients"))) return [];
  const { rows: clients } = await api.query<{
    org_id: string;
    name: string;
    near_account_id: string;
    agency_dao_account_id: string;
  }>(
    "SELECT org_id, name, near_account_id, agency_dao_account_id FROM clients WHERE near_account_id IS NOT NULL",
  );
  const handovers: Handover[] = [];
  for (const client of clients) {
    const { rows: users } = await auth.query<{ userId: string }>(
      `SELECT "userId" FROM "account" WHERE split_part("accountId", ':', 1) = $1 LIMIT 1`,
      [client.near_account_id],
    );
    const ownerUserId = users[0]?.userId ?? null;
    const agency = owners.get(client.agency_dao_account_id);
    const { rows: staff } = agency
      ? await auth.query<{ userId: string }>(
          `SELECT m."userId" FROM "member" m
           JOIN "member" a ON a."userId" = m."userId" AND a."organizationId" = $2
           WHERE m."organizationId" = $1 AND m."userId" <> COALESCE($3, '')`,
          [client.org_id, agency.id, ownerUserId],
        )
      : { rows: [] };
    console.log(
      `  ${client.name} (${client.org_id}): owner ${client.near_account_id} -> ${ownerUserId ?? "no user yet"}, remove ${staff.length} Agency staff`,
    );
    handovers.push({
      clientOrganizationId: client.org_id,
      clientName: client.name,
      ownerUserId,
      nearAccountId: client.near_account_id,
      staffUserIds: staff.map((s) => s.userId),
    });
  }
  return handovers;
}

async function applyHandover(auth: pg.Pool, handover: Handover): Promise<void> {
  if (!handover.ownerUserId) return;
  const client = await auth.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE "member" SET role = 'owner' WHERE "organizationId" = $1 AND "userId" = $2`,
      [handover.clientOrganizationId, handover.ownerUserId],
    );
    if (!rowCount) {
      await client.query(
        `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
         VALUES ($1, $2, $3, 'owner', now())`,
        [crypto.randomUUID(), handover.clientOrganizationId, handover.ownerUserId],
      );
    }
    if (handover.staffUserIds.length > 0) {
      await client.query(
        `DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = ANY($2)`,
        [handover.clientOrganizationId, handover.staffUserIds],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runOrganizationCleanup({
  auth,
  api,
  projects,
  apply,
  keep = new Set<string>(),
}: {
  auth: pg.Pool;
  api: pg.Pool;
  projects: pg.Pool;
  apply: boolean;
  keep?: Set<string>;
}) {
  console.log("Organizations by Agency DAO:");
  const { owners, duplicates } = await organizationsByDao(auth, keep);

  console.log("Client-Project links:");
  const dangling = await danglingProjectLinks(api, projects);

  console.log("Project owners:");
  const moves = await daoOwnedProjects(projects, owners);
  const moved = moves.reduce((sum, m) => sum + m.count, 0);

  console.log("Client Organizations:");
  const handovers = await clientHandovers(auth, api, owners);

  const hasRegistry = await registryExists(api);
  if (!hasRegistry)
    console.log("organization_daos does not exist yet: it will be created on apply.");

  if (!apply) {
    console.log(
      `\nDry run: ${duplicates.length} Organizations and ${dangling.length} links would be deleted, ${moved} Projects moved. Re-run with --apply.`,
    );
    return;
  }
  await api.query(`CREATE TABLE IF NOT EXISTS organization_daos (
      organization_id text PRIMARY KEY,
      dao_account_id text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`);
  await api.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS organization_daos_dao_unique ON organization_daos (dao_account_id)",
  );

  if (duplicates.length > 0)
    await deleteOrganizations(
      auth,
      duplicates.map((o) => o.id),
    );
  for (const link of dangling) {
    if (await tableExists(api, "client_projects")) {
      await api.query("DELETE FROM client_projects WHERE client_id = $1 AND project_id = $2", [
        link.client_id,
        link.project_id,
      ]);
    }
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
      await projects.query("UPDATE projects SET organization_id = $1 WHERE organization_id = $2", [
        move.organizationId,
        move.dao,
      ]);
    }
    const { rows: owned } = await projects.query<{ id: string }>(
      "SELECT id FROM projects WHERE organization_id = ANY($1)",
      [[move.organizationId, move.dao]],
    );
    if (owned.length > 0 && (await tableExists(api, "budgets"))) {
      await api.query("ALTER TABLE budgets ADD COLUMN IF NOT EXISTS dao_account_id text");
      await api.query(
        "UPDATE budgets SET dao_account_id = $1 WHERE dao_account_id IS NULL AND project_id = ANY($2)",
        [move.dao, owned.map((p) => p.id)],
      );
    }
    if (await tableExists(api, "engagements")) {
      const agencyName = owners.get(move.dao)?.name ?? "";
      await api.query(
        `UPDATE engagements SET agency_organization_id = $1 WHERE agency_organization_id = $2`,
        [move.organizationId, move.dao],
      );
      await api.query(
        `UPDATE engagements SET agency_name = $2 WHERE agency_organization_id = $1 AND agency_name = ''`,
        [move.organizationId, agencyName],
      );
    }
  }
  for (const handover of handovers) await applyHandover(auth, handover);
  console.log(
    `\nDeleted ${duplicates.length} Organizations and ${dangling.length} links, moved ${moved} Projects.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const auth = new pg.Pool({ connectionString: requireEnv("AUTH_DATABASE_URL") });
  const api = new pg.Pool({ connectionString: requireEnv("API_DATABASE_URL") });
  const projects = new pg.Pool({ connectionString: requireEnv("PROJECTS_DATABASE_URL") });
  const apply = process.argv.includes("--apply");
  const keep = new Set(
    process.argv.filter((a) => a.startsWith("--keep=")).map((a) => a.slice("--keep=".length)),
  );
  runOrganizationCleanup({ auth, api, projects, apply, keep })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => Promise.all([auth.end(), api.end(), projects.end()]));
}
