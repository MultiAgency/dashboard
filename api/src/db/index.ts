import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseDriver {
  readonly db: Database;
  close(): Promise<void>;
}

export async function createDatabaseDriver(url: string): Promise<DatabaseDriver> {
  if (url.startsWith("pglite:") || url === ":memory:" || url === "memory://") {
    const { drizzle } = await import("drizzle-orm/pglite");
    const stripped = url === ":memory:" ? ":memory:" : url.replace(/^pglite:/, "");
    const isInMemory =
      stripped === ":memory:" || stripped === "memory://" || stripped.endsWith("/:memory:");
    const dataDir = isInMemory ? "memory://" : stripped;
    if (!isInMemory) {
      mkdirSync(dirname(dataDir), { recursive: true });
    }
    const db = drizzle(dataDir, { schema });
    const pglite = (db as any).$client;
    return {
      db,
      close: async () => {
        await pglite?.close?.();
      },
    };
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({
    connectionString: url,
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });
  return {
    db: drizzle(pool, { schema }),
    close: async () => {
      await pool.end();
    },
  };
}
