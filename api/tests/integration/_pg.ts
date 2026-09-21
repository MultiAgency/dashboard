import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "../../src/db/migrations");
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

interface PgliteLike {
  query: (sql: string) => Promise<unknown>;
}

export async function applyAllMigrations(pg: PgliteLike): Promise<void> {
  await applyMigrations(pg, () => true);
}

export async function applyMigrations(
  pg: PgliteLike,
  include: (file: string) => boolean,
): Promise<void> {
  for (const file of MIGRATION_FILES.filter(include)) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
}
