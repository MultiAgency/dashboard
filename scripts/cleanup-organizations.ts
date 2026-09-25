import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Database } from "../api/src/db/index.ts";
import * as apiSchema from "../api/src/db/schema.ts";
import {
  type BetterAuthOrganizationsClient,
  betterAuthOrganizations,
} from "../api/src/lib/organizations.ts";
import { createOrganizationCleanup } from "../api/src/services/organization-cleanup.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see scripts/README.md)`);
  return value;
}

function authApi(baseUrl: string, cookie: string): BetterAuthOrganizationsClient {
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(new URL(`/api/auth${path}`, baseUrl), {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      throw new Error(`Auth API ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  };
  return {
    listOrganizations: () => call("/organization/list"),
    deleteOrganization: (input) =>
      call("/organization/delete", { method: "POST", body: JSON.stringify(input) }),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apiPool = new pg.Pool({ connectionString: requireEnv("API_DATABASE_URL") });
  const api = authApi(requireEnv("AUTH_BASE_URL"), requireEnv("AUTH_SESSION_COOKIE"));

  try {
    const cleanup = createOrganizationCleanup({
      db: drizzle(apiPool, { schema: apiSchema }) as unknown as Database,
      organizations: betterAuthOrganizations(() => api),
    });
    const report = await cleanup.run({ dryRun });
    console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  } finally {
    await apiPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
