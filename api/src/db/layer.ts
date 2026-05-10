import { Context, Effect, Layer } from "every-plugin/effect";
import type { Database } from "./index";

export class DatabaseTag extends Context.Tag("api/Database")<Database, Database>() {}

export const DatabaseLive = (url: string) =>
  Layer.scoped(
    DatabaseTag,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const { createDatabaseDriver } = await import("./index");
        const driver = await createDatabaseDriver(url);
        return driver.db;
      }),
      () => Effect.void,
    ),
  );
