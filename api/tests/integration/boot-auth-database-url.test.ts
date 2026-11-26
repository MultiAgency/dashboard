import { createPluginRuntime } from "every-plugin";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

describe("the API boots with the deploy smoke test's embedded auth database", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  beforeAll(async () => {
    runtime = createPluginRuntime({
      registry: { api: { module: (await import("../../src/index")).default } },
    } as any);
    const plugin = await (runtime as any).usePlugin(
      "api",
      {
        variables: {},
        secrets: { API_DATABASE_URL: ":memory:", AUTH_DATABASE_URL: "pglite:.bos/db/auth" },
      },
      { auth: { client: () => ({}) } },
    );
    clientFor = (context) => plugin.createClient(context);
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  test("serves routes instead of failing to load on a database node-postgres can't reach", async () => {
    await expect(clientFor({}).organizationRequests.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
