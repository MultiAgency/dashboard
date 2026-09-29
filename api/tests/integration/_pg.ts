import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../../src/db/migrations");
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

interface PgliteLike {
  query: (sql: string) => Promise<unknown>;
}

export async function applyAllMigrations(pg: PgliteLike): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
}

export function migratedDatabase(): { pg: PGlite; db: Database } {
  const state = {} as { pg: PGlite; db: Database };
  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    state.pg = new PGlite("memory://");
    await applyAllMigrations(state.pg);
    state.db = drizzle(state.pg, { schema }) as unknown as Database;
  });
  afterAll(async () => {
    await state.pg.close();
  });
  return state;
}
