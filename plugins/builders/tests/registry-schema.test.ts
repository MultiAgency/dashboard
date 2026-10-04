import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PluginIdTag } from "every-plugin";
import { Effect, Layer, ManagedRuntime } from "every-plugin/effect";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DatabaseLive, DatabaseTag } from "../src/db/layer";
import { builders } from "../src/db/schema";
import { BuilderService, BuilderServiceLive } from "../src/services/builders";

const PLUGIN_ID = "@everything-dev/builders-plugin";
const MIGRATIONS = join(import.meta.dirname, "../src/db/migrations");

const migrationTags: string[] = JSON.parse(
  readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8"),
).entries.map((entry: { tag: string }) => entry.tag);

async function applyMigration(db: PGlite, tag: string) {
  const statements = readFileSync(join(MIGRATIONS, `${tag}.sql`), "utf8").split(
    "--> statement-breakpoint",
  );
  for (const statement of statements) {
    if (statement.trim()) await db.exec(statement);
  }
}

describe("the registry migration on a database with builders", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const tag of migrationTags.slice(0, 1)) await applyMigration(db, tag);
    await db.exec(`
      INSERT INTO builders (id, near_account, user_id, name, skills)
      VALUES ('bld_ada', 'ada.near', 'ada', 'Ada', '["rust"]'),
             ('bld_bob', 'bob.near', NULL, 'Bob', NULL)
    `);
    for (const tag of migrationTags.slice(1)) await applyMigration(db, tag);
  });

  afterAll(async () => {
    await db.close();
  });

  test("keeps existing builders as humans with no registry data", async () => {
    const { rows } = await db.query(
      "SELECT id, near_account, name, skills, kind, github_login, operator_id FROM builders ORDER BY id",
    );

    expect(rows).toEqual([
      {
        id: "bld_ada",
        near_account: "ada.near",
        name: "Ada",
        skills: '["rust"]',
        kind: "human",
        github_login: null,
        operator_id: null,
      },
      {
        id: "bld_bob",
        near_account: "bob.near",
        name: "Bob",
        skills: null,
        kind: "human",
        github_login: null,
        operator_id: null,
      },
    ]);
  });

  test("allows several members with no NEAR account but not a repeated one", async () => {
    await db.exec(
      "INSERT INTO builders (id, github_login) VALUES ('bld_grace', 'grace'), ('bld_linus', 'linus')",
    );

    await expect(
      db.exec("INSERT INTO builders (id, near_account) VALUES ('bld_copy', 'ada.near')"),
    ).rejects.toThrow(/builders_near_account_unique/);
  });

  test.each([
    [
      "a GitHub login with capitals",
      "INSERT INTO builders (id, github_login) VALUES ('x', 'Grace')",
    ],
    ["an unknown kind", "INSERT INTO builders (id, kind) VALUES ('x', 'robot')"],
    ["an agent with no operator", "INSERT INTO builders (id, kind) VALUES ('x', 'agent')"],
    ["a human with an operator", "INSERT INTO builders (id, operator_id) VALUES ('x', 'bld_ada')"],
    [
      "an account on an unknown network",
      "INSERT INTO builder_accounts (builder_id, network, account, proof, verified_at) VALUES ('bld_ada', 'devnet', 'ada.near', 'sig', now())",
    ],
    [
      "an admission on an unknown network",
      "INSERT INTO builder_admissions (builder_id, network, status) VALUES ('bld_ada', 'devnet', 'admitted')",
    ],
    [
      "an unknown admission status",
      "INSERT INTO builder_admissions (builder_id, network, status) VALUES ('bld_ada', 'testnet', 'pending')",
    ],
  ])("rejects %s", async (_name, statement) => {
    await expect(db.exec(statement)).rejects.toThrow(/check/);
  });

  test("allows an agent with an operator", async () => {
    await db.exec(
      "INSERT INTO builders (id, github_login, kind, operator_id) VALUES ('bld_bot', 'ada-bot', 'agent', 'bld_ada')",
    );
  });

  test("allows one account per network, each held by one member", async () => {
    await db.exec(`
      INSERT INTO builder_accounts (builder_id, network, account, proof, verified_at)
      VALUES ('bld_grace', 'testnet', 'grace.testnet', 'sig', now())
    `);

    await expect(
      db.exec(`
        INSERT INTO builder_accounts (builder_id, network, account, proof, verified_at)
        VALUES ('bld_grace', 'testnet', 'grace2.testnet', 'sig', now())
      `),
    ).rejects.toThrow(/builder_accounts_builder_id_network_pk/);
    await expect(
      db.exec(`
        INSERT INTO builder_accounts (builder_id, network, account, proof, verified_at)
        VALUES ('bld_linus', 'testnet', 'grace.testnet', 'sig', now())
      `),
    ).rejects.toThrow(/builder_accounts_network_account_idx/);
  });

  test("admits a member on each network separately", async () => {
    await db.exec(`
      INSERT INTO builder_admissions (builder_id, network, status)
      VALUES ('bld_bob', 'testnet', 'admitted'), ('bld_bob', 'mainnet', 'suspended')
    `);

    await expect(
      db.exec(
        "INSERT INTO builder_admissions (builder_id, network, status) VALUES ('bld_bob', 'testnet', 'removed')",
      ),
    ).rejects.toThrow(/builder_admissions_builder_id_network_pk/);
  });

  test("keeps a builder with an admission from being deleted", async () => {
    await expect(db.exec("DELETE FROM builders WHERE id = 'bld_bob'")).rejects.toThrow(
      /builder_admissions_builder_id_builders_id_fk/,
    );
  });
});

const layer = BuilderServiceLive.pipe(
  Layer.provideMerge(DatabaseLive(":memory:")),
  Layer.provide(Layer.succeed(PluginIdTag, PLUGIN_ID)),
);

describe("a member with no mainnet account", () => {
  let runtime: ManagedRuntime.ManagedRuntime<Layer.Layer.Success<typeof layer>, unknown>;
  const run = <A, E>(effect: Effect.Effect<A, E, Layer.Layer.Success<typeof layer>>) =>
    runtime.runPromise(effect);

  beforeAll(async () => {
    runtime = ManagedRuntime.make(layer);
    await run(
      Effect.gen(function* () {
        const db = yield* DatabaseTag;
        yield* Effect.promise(() =>
          db.insert(builders).values([
            { id: "bld_listed", nearAccount: "ada.near", userId: "ada", name: "Ada" },
            { id: "bld_testnet", githubLogin: "grace", userId: "grace", name: "Grace" },
          ]),
        );
      }),
    );
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  test("is left out of the builder list and its total", async () => {
    const result = await run(Effect.flatMap(BuilderService, (service) => service.listBuilders({})));

    expect(result.data.map((b) => b.nearAccount)).toEqual(["ada.near"]);
    expect(result.meta.total).toBe(1);
  });

  test("is left out of a search that matches it", async () => {
    const result = await run(
      Effect.flatMap(BuilderService, (service) => service.listBuilders({ search: "Grace" })),
    );

    expect(result.data).toEqual([]);
  });

  test("is not returned as the signed-in user's profile", async () => {
    const result = await run(
      Effect.flatMap(BuilderService, (service) => service.getBuilderByUserId("grace")),
    );

    expect(result).toBeNull();
  });
});
