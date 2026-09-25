import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Database } from "../api/src/db/index.ts";
import * as apiSchema from "../api/src/db/schema.ts";
import { createProjectOwnershipMigration } from "../api/src/services/project-ownership.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see scripts/README.md)`);
  return value;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apiPool = new pg.Pool({ connectionString: requireEnv("API_DATABASE_URL") });
  const projectsPool = new pg.Pool({ connectionString: requireEnv("PROJECTS_DATABASE_URL") });

  try {
    const migration = createProjectOwnershipMigration({
      db: drizzle(apiPool, { schema: apiSchema }) as unknown as Database,
      projectsDb: projectsPool,
    });
    const report = await migration.run({ dryRun });
    console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  } finally {
    await apiPool.end();
    await projectsPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
