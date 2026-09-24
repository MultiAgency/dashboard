import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../../src/db/migrations");
const PROJECTS_MIGRATIONS_DIR = resolve(HERE, "../../../plugins/projects/src/db/migrations");

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => resolve(dir, f));
}

interface PgliteLike {
  query: (sql: string) => Promise<unknown>;
}

async function applyMigrationsFrom(dir: string, pg: PgliteLike): Promise<void> {
  for (const file of sqlFiles(dir)) {
    const sql = readFileSync(file, "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
}

export function applyAllMigrations(pg: PgliteLike): Promise<void> {
  return applyMigrationsFrom(MIGRATIONS_DIR, pg);
}

export function applyProjectsPluginMigrations(pg: PgliteLike): Promise<void> {
  return applyMigrationsFrom(PROJECTS_MIGRATIONS_DIR, pg);
}

export function migratedDatabase(options: { perTest?: boolean } = {}): {
  pg: PGlite;
  db: Database;
} {
  const state = {} as { pg: PGlite; db: Database };
  const [before, after] = options.perTest ? [beforeEach, afterEach] : [beforeAll, afterAll];
  before(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    state.pg = new PGlite("memory://");
    await applyAllMigrations(state.pg);
    state.db = drizzle(state.pg, { schema }) as unknown as Database;
  });
  after(async () => {
    await state.pg.close();
  });
  return state;
}
