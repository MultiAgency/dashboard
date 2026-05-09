import { Context, Effect, Layer } from "every-plugin/effect";
import type { DatabaseDriver } from "./index";

export class DatabaseTag extends Context.Tag("api/Database")<DatabaseDriver, DatabaseDriver>() {}

export const DatabaseLive = (url: string) =>
  Layer.scoped(
    DatabaseTag,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const { createDatabaseDriver } = await import("./index");
        const driver = await createDatabaseDriver(url);
        return driver;
      }),
      (driver) =>
        Effect.promise(async () => {
          await driver.close();
        }),
    ),
  );
