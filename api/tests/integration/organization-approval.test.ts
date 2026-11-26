import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { createPluginRuntime } from "every-plugin";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { organizationApprovals } from "../../src/db/schema";
import { authDatabaseDirectory } from "../../src/lib/auth-database";
import type { EmailMessage } from "../../src/services/notify";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import {
  approvalRecordedByAuth,
  createOrganizationApprovals,
} from "../../src/services/organization-approvals";
import { createOrganizationRequestsService } from "../../src/services/organization-requests";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizations, signedIn } from "../fakes/organizations";
import { inMemoryProjects } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

async function authDatabase(options: { status: boolean } = { status: true }) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite("memory://");
  await pg.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE);
    CREATE TABLE "organization" (
      id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text,
      created_at timestamp NOT NULL
      ${options.status ? `, status text DEFAULT 'active' NOT NULL, rejection_reason text` : ""}
    );
    CREATE TABLE "member" (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES "organization"(id),
      user_id text NOT NULL REFERENCES "user"(id),
      role text NOT NULL,
      created_at timestamp NOT NULL
    );
    INSERT INTO "user" VALUES ('ada', 'Ada', 'ada@example.com'), ('bo', 'Bo', 'bo@near.email');
    INSERT INTO "organization" (id, name, slug, metadata, created_at) VALUES
      ('live', 'Live', 'live', '{}', now() - interval '60 days'),
      ('asked', 'Asked', 'asked', '{}', now() - interval '30 days'),
      ('refused', 'Refused', 'refused', '{}', now() - interval '29 days'),
      ('fresh', 'Fresh', 'fresh', '{}', now() + interval '1 second'),
      ('ada-home', 'Ada', 'ada-home', '{"isPersonal":true}', now() - interval '61 days');
    INSERT INTO "member" VALUES
      ('m1', 'live', 'ada', 'owner', now()),
      ('m2', 'asked', 'ada', 'owner', now()),
      ('m3', 'refused', 'ada', 'owner', now()),
      ('m4', 'fresh', 'bo', 'owner', now()),
      ('m5', 'fresh', 'ada', 'member', now()),
      ('m6', 'ada-home', 'ada', 'owner', now());
    CREATE TABLE "near_account" (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id),
      account_id text NOT NULL,
      network text NOT NULL,
      public_key text NOT NULL,
      is_primary boolean DEFAULT false,
      created_at timestamptz NOT NULL
    );
    INSERT INTO "near_account" VALUES
      ('n1', 'bo', 'bo-old.near', 'mainnet', 'ed25519:x', false, now()),
      ('n2', 'bo', 'bo.near', 'mainnet', 'ed25519:y', true, now());
  `);
  if (options.status) {
    await pg.exec(`
      UPDATE "organization" SET status = 'pending' WHERE id = 'asked';
      UPDATE "organization" SET status = 'rejected', rejection_reason = 'Duplicate of Live' WHERE id = 'refused';
    `);
  }
  return pg;
}

const sqlOf = (pg: PGlite) => ({
  query: <T>(text: string, params?: unknown[]) =>
    pg.query<T>(text, params as never[]) as Promise<{ rows: T[] }>,
});

describe("approvals adopted from the auth plugin", () => {
  const api = migratedDatabase({ perTest: true });
  let pg: PGlite;

  afterEach(async () => {
    await pg.close();
  });

  const adopt = async () => {
    const directory = authDatabaseDirectory(sqlOf(pg));
    return createOrganizationApprovals(api.db).adopt(async () =>
      (await directory.all())
        .filter((record) => !record.organization.isPersonal)
        .map(approvalRecordedByAuth),
    );
  };

  test("keep each earlier Organization's decision, and leave one created since the upgrade waiting", async () => {
    pg = await authDatabase();
    expect(await adopt()).toBe(true);
    const approvals = await createOrganizationApprovals(api.db).of([
      "live",
      "asked",
      "refused",
      "fresh",
    ]);
    expect(Object.fromEntries(approvals)).toEqual({
      live: { status: "approved", rejectionReason: null },
      asked: { status: "pending", rejectionReason: null },
      refused: { status: "rejected", rejectionReason: "Duplicate of Live" },
      fresh: { status: "pending", rejectionReason: null },
    });
  });

  test("count every Organization as approved on an auth database without approval", async () => {
    pg = await authDatabase({ status: false });
    await adopt();
    const approvals = await createOrganizationApprovals(api.db).of(["asked", "refused"]);
    expect([...approvals.values()].map((a) => a.status)).toEqual(["approved", "approved"]);
  });

  test("happen once, so Organizations created later wait for review", async () => {
    pg = await authDatabase();
    await adopt();
    await pg.exec(
      `INSERT INTO "organization" (id, name, slug, metadata, created_at) VALUES ('later', 'Later', 'later', '{}', now())`,
    );
    expect(await adopt()).toBe(false);
    const approvals = createOrganizationApprovals(api.db);
    expect(await approvals.isApproved("later")).toBe(false);
    expect((await approvals.of(["later"])).get("later")).toEqual({
      status: "pending",
      rejectionReason: null,
    });
  });

  test("happen once when two instances boot together", async () => {
    pg = await authDatabase();
    const results = await Promise.all([adopt(), adopt()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await api.db.select().from(organizationApprovals);
    expect(rows.map((r) => r.organizationId).sort()).toEqual(["asked", "live", "refused"]);
  });

  test("record only earlier Organizations, leaving personal ones out", async () => {
    pg = await authDatabase();
    await adopt();
    const rows = await api.db.select().from(organizationApprovals);
    expect(rows.map((r) => r.organizationId).sort()).toEqual(["asked", "live", "refused"]);
  });
});

describe("Organization routes behind approval", () => {
  const api = migratedDatabase({ perTest: true });
  const seed = {
    organizations: [
      { id: "studio", name: "Studio" },
      { id: "ada-home", name: "Ada", isPersonal: true },
    ],
    members: [
      { userId: "ada", organizationId: "studio", role: "owner" as const },
      { userId: "ada", organizationId: "ada-home", role: "owner" as const },
    ],
  };

  const accessWith = () =>
    createOrganizationAccess({
      db: api.db,
      organizations: inMemoryOrganizations(seed).port,
      approvals: createOrganizationApprovals(api.db),
      directory: createProjectDirectory(() => inMemoryProjects([]).client),
    });

  test("refuse an Organization that no site admin has approved, even created by its own owner", async () => {
    const access = accessWith();
    await expect(
      access.agencyScope(signedIn("ada", "studio"), ROLE_MATRIX.work),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await access.resolve(signedIn("ada", "studio"))).organization).toBeNull();
  });

  test("serve it once approved", async () => {
    await createOrganizationApprovals(api.db).decide(
      "studio",
      { status: "approved" },
      "site-admin",
    );
    const scope = await accessWith().agencyScope(signedIn("ada", "studio"), ROLE_MATRIX.work);
    expect(scope.organizationId).toBe("studio");
  });

  test("refuse it again once rejected", async () => {
    const approvals = createOrganizationApprovals(api.db);
    await approvals.decide("studio", { status: "approved" }, "site-admin");
    await approvals.decide("studio", { status: "rejected", reason: "Spam" }, "site-admin");
    await expect(
      accessWith().agencyScope(signedIn("ada", "studio"), ROLE_MATRIX.work),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("leave a personal Organization as it was, with no role and nothing to approve", async () => {
    const access = await accessWith().resolve(signedIn("ada", "ada-home"));
    expect(access.organization?.id).toBe("ada-home");
    expect(access.role).toBeNull();
  });
});

describe("the review queue", () => {
  const api = migratedDatabase({ perTest: true });
  let pg: PGlite;

  beforeEach(async () => {
    pg = await authDatabase();
  });

  afterEach(async () => {
    await pg.close();
  });

  const createdAt = async (id: string) => {
    const { rows } = await pg.query<{ created_at: Date }>(
      `SELECT created_at FROM "organization" WHERE id = $1`,
      [id],
    );
    return new Date(rows[0]!.created_at).toISOString();
  };

  const service = () =>
    createOrganizationRequestsService({
      organizations: authDatabaseDirectory(sqlOf(pg)),
      approvals: createOrganizationApprovals(api.db, () => new Date("2026-11-27T12:00:00Z")),
      sendEmail: null,
      appOrigin: "https://dev.multiagency.example",
    });

  const approved = (...ids: string[]) =>
    Promise.all(
      ids.map((id) =>
        createOrganizationApprovals(api.db).decide(id, { status: "approved" }, "site-admin"),
      ),
    );

  test("lists every Organization without a decision, with its owner and when it was made", async () => {
    await approved("live");
    await createOrganizationApprovals(api.db).decide(
      "refused",
      { status: "rejected", reason: "No" },
      "site-admin",
    );
    expect(await service().pending()).toEqual([
      {
        id: "asked",
        name: "Asked",
        slug: "asked",
        requestedBy: "ada",
        requestedByName: "Ada",
        requestedByEmail: "ada@example.com",
        requestedByNearAccount: null,
        requestedAt: await createdAt("asked"),
      },
      {
        id: "fresh",
        name: "Fresh",
        slug: "fresh",
        requestedBy: "bo",
        requestedByName: "Bo",
        requestedByEmail: null,
        requestedByNearAccount: "bo.near",
        requestedAt: await createdAt("fresh"),
      },
    ]);
  });

  test("names the requester by their primary NEAR account on an auth database without one, falling back cleanly", async () => {
    await pg.exec(`DROP TABLE "near_account"`);
    const fresh = (await service().pending()).find((r) => r.id === "fresh");
    expect(fresh).toMatchObject({ requestedByName: "Bo", requestedByNearAccount: null });
  });

  test("approving takes an Organization off the queue and records who approved it", async () => {
    await approved("live", "asked", "refused");
    expect(
      await service().review({ organizationId: "fresh", decision: "approve" }, "site-admin"),
    ).toEqual({ id: "fresh", status: "approved", adminInvite: null });
    expect(await service().pending()).toEqual([]);
    const [row] = await api.db
      .select()
      .from(organizationApprovals)
      .where(eq(organizationApprovals.organizationId, "fresh"));
    expect(row).toMatchObject({
      status: "approved",
      reviewedBy: "site-admin",
      reviewedAt: new Date("2026-11-27T12:00:00Z"),
    });
  });

  test("rejecting keeps the reason for the people who asked", async () => {
    expect(
      await service().review(
        { organizationId: "fresh", decision: "reject", reason: "Duplicate of Live" },
        "site-admin",
      ),
    ).toEqual({ id: "fresh", status: "rejected", adminInvite: null });
    expect((await createOrganizationApprovals(api.db).of(["fresh"])).get("fresh")).toEqual({
      status: "rejected",
      rejectionReason: "Duplicate of Live",
    });
  });

  test.each([
    "missing",
    "ada-home",
  ])("refuses to review %s, which is not an Organization to approve", async (id) => {
    await expect(
      service().review({ organizationId: id, decision: "approve" }, "site-admin"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await api.db.select().from(organizationApprovals)).toEqual([]);
  });
});

describe("organization approval routes", () => {
  const ID = "api";
  let runtime: ReturnType<typeof createPluginRuntime>;
  let clientFor: (context: object) => any;

  const caller = (role: "admin" | "user") => ({
    userId: `${role}-1`,
    user: { id: `${role}-1`, role },
    reqHeaders: new Headers({ cookie: `session=${role}` }),
  });

  beforeAll(async () => {
    runtime = createPluginRuntime({
      registry: { [ID]: { module: (await import("../../src/index")).default } },
    } as any);
    const plugin = await (runtime as any).usePlugin(
      ID,
      { variables: {}, secrets: { API_DATABASE_URL: ":memory:" } },
      { auth: { client: () => ({}) } },
    );
    clientFor = (context) => plugin.createClient(context);
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown();
  });

  test("refuse a caller who isn't signed in", async () => {
    await expect(clientFor({}).organizationRequests.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("refuse a signed-in user who isn't a site admin", async () => {
    const user = clientFor(caller("user"));
    await expect(user.organizationRequests.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      user.organizationRequests.review({ organizationId: "asked", decision: "approve" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("refuse an invalid admin email before approving anything", async () => {
    await expect(
      clientFor(caller("admin")).organizationRequests.review({
        organizationId: "asked",
        decision: "approve",
        adminEmail: "not-an-email",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("reject only with a reason", async () => {
    await expect(
      clientFor(caller("admin")).organizationRequests.review({
        organizationId: "asked",
        decision: "reject",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("refuse Organization routes for an owner whose Organization isn't approved", async () => {
    const owner = clientFor({
      ...caller("user"),
      organization: {
        activeOrganizationId: "studio",
        organization: { id: "studio", name: "Studio", slug: "studio", metadata: null },
        member: { id: "m-studio", role: "owner" },
      },
    });
    await expect(owner.workOrders.setupStatus({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the admin invite sent on approval", () => {
  const api = migratedDatabase();
  let pg: PGlite;
  const sent: EmailMessage[] = [];

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await pg.exec(`
      CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE);
      CREATE TABLE "organization" (
        id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text,
        created_at timestamp NOT NULL, status text DEFAULT 'active' NOT NULL
      );
      CREATE TABLE "member" (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES "organization"(id),
        user_id text NOT NULL REFERENCES "user"(id),
        role text NOT NULL,
        created_at timestamp NOT NULL
      );
      CREATE TABLE "invitation" (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES "organization"(id),
        email text NOT NULL,
        role text,
        status text NOT NULL,
        expires_at timestamptz NOT NULL,
        inviter_id text NOT NULL REFERENCES "user"(id),
        created_at timestamp NOT NULL
      );
      INSERT INTO "user" VALUES ('site-admin', 'Site Admin', 'admin@multiagency.example');
      INSERT INTO "organization" (id, name, slug, metadata, created_at) VALUES ('asked', 'Asked & Co', 'asked', '{}', now());
    `);
    sent.length = 0;
  });

  afterEach(async () => {
    await pg?.close();
  });

  const service = (sendEmail: ((message: EmailMessage) => Promise<void>) | null) =>
    createOrganizationRequestsService({
      organizations: authDatabaseDirectory(sqlOf(pg)),
      approvals: createOrganizationApprovals(api.db),
      sendEmail,
      appOrigin: "https://dev.multiagency.example",
      now: () => new Date("2026-10-30T12:00:00Z"),
    });

  test("records a pending admin invitation from the approving admin and emails its accept link", async () => {
    const invite = await service(async (message) => {
      sent.push(message);
    }).inviteAdmin({
      organizationId: "asked",
      email: " Lead@Client.example ",
      inviterId: "site-admin",
    });

    expect(invite).toEqual({ status: "invited", email: "lead@client.example" });
    const { rows } = await pg.query<{
      id: string;
      email: string;
      role: string;
      status: string;
      inviter_id: string;
      expires_at: Date;
    }>(`SELECT id, email, role, status, inviter_id, expires_at FROM "invitation"`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "lead@client.example",
      role: "admin",
      status: "pending",
      inviter_id: "site-admin",
    });
    expect(new Date(rows[0]!.expires_at).toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("lead@client.example");
    expect(sent[0]!.subject).toBe("You're invited to Asked & Co on MultiAgency");
    expect(sent[0]!.html).toContain("Asked &amp; Co");
    expect(sent[0]!.html).toContain(
      `https://dev.multiagency.example/accept-invitation/${rows[0]!.id}?email=lead%40client.example`,
    );
  });

  test("keeps the invitation when the email can't be sent", async () => {
    const invite = await service(async () => {
      throw new Error("mail down");
    }).inviteAdmin({
      organizationId: "asked",
      email: "lead@client.example",
      inviterId: "site-admin",
    });
    expect(invite).toEqual({ status: "invited", email: "lead@client.example" });
    const { rows } = await pg.query(`SELECT 1 FROM "invitation"`);
    expect(rows).toHaveLength(1);
  });

  test("reports a failure by kind when the invitation can't be recorded", async () => {
    const invite = await service(null).inviteAdmin({
      organizationId: "missing",
      email: "lead@client.example",
      inviterId: "site-admin",
    });
    expect(invite).toMatchObject({ status: "failed" });
    const { rows } = await pg.query(`SELECT 1 FROM "invitation"`);
    expect(rows).toHaveLength(0);
  });
});
