import type { PGlite } from "@electric-sql/pglite";
import { createPluginRuntime } from "every-plugin";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { authDatabaseDirectory } from "../../src/lib/auth-database";

async function authDatabase(withStatus: boolean) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite("memory://");
  await pg.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE);
    CREATE TABLE "organization" (
      id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text,
      created_at timestamp NOT NULL
      ${withStatus ? `, status text DEFAULT 'active' NOT NULL` : ""}
    );
    CREATE TABLE "member" (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES "organization"(id),
      user_id text NOT NULL REFERENCES "user"(id),
      role text NOT NULL,
      created_at timestamp NOT NULL
    );
    INSERT INTO "user" VALUES ('ada', 'Ada', 'ada@example.com');
    INSERT INTO "organization" (id, name, slug, metadata, created_at) VALUES
      ('live', 'Live', 'live', '{}', now()),
      ('asked', 'Asked', 'asked', '{}', now()),
      ('refused', 'Refused', 'refused', '{}', now());
    INSERT INTO "member" VALUES
      ('m1', 'live', 'ada', 'owner', now()),
      ('m2', 'asked', 'ada', 'owner', now()),
      ('m3', 'refused', 'ada', 'owner', now());
  `);
  if (withStatus) {
    await pg.exec(`
      UPDATE "organization" SET status = 'pending' WHERE id = 'asked';
      UPDATE "organization" SET status = 'rejected' WHERE id = 'refused';
    `);
  }
  return pg;
}

const sqlOf = (pg: PGlite) => ({
  query: <T>(text: string, params?: unknown[]) =>
    pg.query<T>(text, params as never[]) as Promise<{ rows: T[] }>,
});

describe("memberships offered for activation", () => {
  let pg: PGlite;

  afterEach(async () => {
    await pg.close();
  });

  test("leave out Organizations waiting for approval or rejected", async () => {
    pg = await authDatabase(true);
    const directory = authDatabaseDirectory(sqlOf(pg) as never);
    const ids = (await directory.memberships("ada")).map((m) => m.organization.id);
    expect(ids).toEqual(["live"]);
  });

  test("include an Organization once it is approved", async () => {
    pg = await authDatabase(true);
    await pg.exec(`UPDATE "organization" SET status = 'active' WHERE id = 'asked'`);
    const directory = authDatabaseDirectory(sqlOf(pg) as never);
    const ids = (await directory.memberships("ada")).map((m) => m.organization.id).sort();
    expect(ids).toEqual(["asked", "live"]);
  });

  test("are unchanged on an auth database without approval", async () => {
    pg = await authDatabase(false);
    const directory = authDatabaseDirectory(sqlOf(pg) as never);
    const ids = (await directory.memberships("ada")).map((m) => m.organization.id).sort();
    expect(ids).toEqual(["asked", "live", "refused"]);
  });

  test("filter by status once the auth migration adds it, without a restart", async () => {
    pg = await authDatabase(false);
    const directory = authDatabaseDirectory(sqlOf(pg) as never);
    expect((await directory.memberships("ada")).map((m) => m.organization.id).sort()).toEqual([
      "asked",
      "live",
      "refused",
    ]);
    await pg.exec(`
      ALTER TABLE "organization" ADD COLUMN status text DEFAULT 'active' NOT NULL;
      UPDATE "organization" SET status = 'pending' WHERE id = 'asked';
      UPDATE "organization" SET status = 'rejected' WHERE id = 'refused';
    `);
    expect((await directory.memberships("ada")).map((m) => m.organization.id)).toEqual(["live"]);
  });
});

describe("organization approval routes", () => {
  const ID = "api";
  const reviews: Array<{ input: unknown; cookie: string | null }> = [];
  const lists: Array<string | null> = [];
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  const fakeAuth = {
    client: (context: { reqHeaders?: Record<string, string> }) => ({
      listOrganizationRequests: async () => {
        lists.push(context.reqHeaders?.cookie ?? null);
        return [
          {
            id: "asked",
            name: "Asked",
            slug: "asked",
            status: "pending",
            requestedBy: "ada",
            createdAt: new Date("2026-10-27T10:00:00Z"),
          },
        ];
      },
      reviewOrganization: async (input: { organizationId: string; decision: string }) => {
        reviews.push({ input, cookie: context.reqHeaders?.cookie ?? null });
        return {
          id: input.organizationId,
          status: input.decision === "approve" ? "active" : "rejected",
        };
      },
    }),
  };

  const caller = (role: "admin" | "user") => ({
    userId: `${role}-1`,
    user: { id: `${role}-1`, role },
    reqHeaders: new Headers({ cookie: `session=${role}` }),
  });

  const memberOf = (role: "owner" | "member", status: string) => ({
    ...caller("user"),
    organization: {
      activeOrganizationId: "studio",
      organization: { id: "studio", name: "Studio", slug: "studio", metadata: null, status },
      member: { id: "m-studio", role },
    },
  });

  beforeAll(async () => {
    runtime = createPluginRuntime({
      registry: { [ID]: { module: (await import("../../src/index")).default } },
    } as any);
    const plugin = await (runtime as any).usePlugin(
      ID,
      { variables: {}, secrets: { API_DATABASE_URL: ":memory:" } },
      { auth: fakeAuth },
    );
    clientFor = (context) => plugin.createClient(context);
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  beforeEach(() => {
    reviews.length = 0;
    lists.length = 0;
  });

  test("refuse a caller who isn't signed in", async () => {
    await expect(clientFor({}).organizationRequests.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("refuse a signed-in user who isn't a site admin, without asking the auth plugin", async () => {
    const user = clientFor(caller("user"));
    await expect(user.organizationRequests.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      user.organizationRequests.review({ organizationId: "asked", decision: "approve" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(lists).toEqual([]);
    expect(reviews).toEqual([]);
  });

  test("list pending requests for a site admin, with who asked and when", async () => {
    const { data } = await clientFor(caller("admin")).organizationRequests.list();
    expect(data).toEqual([
      {
        id: "asked",
        name: "Asked",
        slug: "asked",
        requestedBy: "ada",
        requestedByEmail: null,
        requestedAt: "2026-10-27T10:00:00.000Z",
      },
    ]);
    expect(lists).toEqual(["session=admin"]);
  });

  test("approve as the site admin's own session", async () => {
    const admin = clientFor(caller("admin"));
    expect(
      await admin.organizationRequests.review({ organizationId: "asked", decision: "approve" }),
    ).toEqual({ id: "asked", status: "active" });
    expect(reviews).toEqual([
      { input: { organizationId: "asked", decision: "approve" }, cookie: "session=admin" },
    ]);
  });

  test.each([
    "pending",
    "rejected",
  ])("refuse Organization routes while the active Organization is %s", async (status) => {
    const owner = clientFor(memberOf("owner", status));
    await expect(owner.workOrders.payoutAgent({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("serve Organization routes once the active Organization is active", async () => {
    const owner = clientFor(memberOf("owner", "active"));
    await expect(owner.workOrders.payoutAgent({})).resolves.toMatchObject({ settings: null });
  });

  test("reject only with a reason", async () => {
    const admin = clientFor(caller("admin"));
    await expect(
      admin.organizationRequests.review({ organizationId: "asked", decision: "reject" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await admin.organizationRequests.review({
        organizationId: "asked",
        decision: "reject",
        reason: "Duplicate of Live",
      }),
    ).toEqual({ id: "asked", status: "rejected" });
    expect(reviews.map((r) => r.input)).toEqual([
      { organizationId: "asked", decision: "reject", reason: "Duplicate of Live" },
    ]);
  });
});
