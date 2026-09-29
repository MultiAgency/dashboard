import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { authDatabaseMembers } from "../api/src/lib/auth-database.ts";
import {
  createOrganizationRecovery,
  OwnerRecoveryError,
} from "../api/src/services/organization-recovery.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const USAGE = "Usage: bun run db:assign-owner <organization-id> <user-email-or-id> [--dry-run]";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [organizationId, user] = args.filter((a) => !a.startsWith("--"));
  if (!organizationId || !user) throw new Error(USAGE);

  const connectionString = process.env.AUTH_DATABASE_URL;
  if (!connectionString) throw new Error("AUTH_DATABASE_URL must be set (see scripts/README.md)");

  const pool = new pg.Pool({ connectionString });
  try {
    const recovery = createOrganizationRecovery({ members: authDatabaseMembers(pool) });
    const result = await recovery.assignOwner({ organizationId, user, dryRun });
    console.log(JSON.stringify({ dryRun, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof OwnerRecoveryError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
});
