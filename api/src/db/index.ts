import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const createDatabase = (url: string, authToken?: string) => {
  const client = createClient({
    url,
    authToken,
  });

  return drizzle({ client, schema });
};

let apiDatabaseUrl: string | null = null;
let apiDatabaseAuthToken: string | undefined;
let cachedDatabase: ReturnType<typeof createDatabase> | null = null;

export const setApiDatabaseConfig = (url: string, authToken?: string) => {
  apiDatabaseUrl = url;
  apiDatabaseAuthToken = authToken;
};

export const getDatabase = () => {
  if (!cachedDatabase) {
    if (!apiDatabaseUrl) {
      throw new Error("API database URL not configured. Call setApiDatabaseConfig() first.");
    }
    cachedDatabase = createDatabase(apiDatabaseUrl, apiDatabaseAuthToken);
  }

  return cachedDatabase;
};

export type Database = ReturnType<typeof createDatabase>;
