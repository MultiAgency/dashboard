import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function createDatabase(url: string): Promise<Database> {
  if (url.startsWith("pglite:") || url === ":memory:") {
    const { drizzle: pgliteDrizzle } = await import("drizzle-orm/pglite");
    const dataDir = url === ":memory:" || url.endsWith("/:memory:")
      ? ":memory:"
      : url.replace("pglite:", "");
    return pgliteDrizzle(dataDir, { schema }) as unknown as Database;
  }

  const pool = new Pool({
    connectionString: url,
    ssl:
      url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });
  return drizzle(pool, { schema });
}
