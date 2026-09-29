import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { authDatabaseMembers } from "../../src/lib/auth-database";
import { createOrganizationRecovery } from "../../src/services/organization-recovery";

const NAMINGS = {
  camelCase: { organizationId: "organizationId", userId: "userId", createdAt: "createdAt" },
  snake_case: { organizationId: "organization_id", userId: "user_id", createdAt: "created_at" },
};

async function betterAuthShapedDatabase(naming: (typeof NAMINGS)[keyof typeof NAMINGS]) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite("memory://");
  await pg.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE);
    CREATE TABLE "organization" (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL, metadata text);
    CREATE TABLE "member" (
      id text PRIMARY KEY,
      "${naming.organizationId}" text NOT NULL REFERENCES "organization"(id),
      "${naming.userId}" text NOT NULL REFERENCES "user"(id),
      role text NOT NULL,
      "${naming.createdAt}" timestamp NOT NULL
    );
    INSERT INTO "user" VALUES ('alice', 'Alice', 'alice@example.com'), ('staff', 'Staff', 'staff@example.com');
    INSERT INTO "organization" VALUES
      ('client', 'Client Co', 'client', '{}'),
      ('owned', 'Owned Co', 'owned', null),
      ('personal', 'Alice', 'alice', '{"isPersonal":true}');
    INSERT INTO "member" VALUES
      ('m1', 'client', 'staff', 'admin', now()),
      ('m2', 'owned', 'staff', 'owner', now());
  `);
  return pg;
}

async function roleOf(pg: PGlite, userId: string, organizationId: string, naming: string[]) {
  const [orgColumn, userColumn] = naming;
  const { rows } = await pg.query<{ role: string }>(
    `SELECT role FROM "member" WHERE "${orgColumn}" = $1 AND "${userColumn}" = $2`,
    [organizationId, userId],
  );
  return rows[0]?.role ?? null;
}

describe.each(Object.entries(NAMINGS))("owner recovery on a %s auth database", (_, naming) => {
  let pg: PGlite;
  const columns = [naming.organizationId, naming.userId];

  beforeEach(async () => {
    pg = await betterAuthShapedDatabase(naming);
  });

  afterEach(async () => {
    await pg.close();
  });

  function recovery() {
    return createOrganizationRecovery({ members: authDatabaseMembers(pg) });
  }

  test("adds a user found by email as owner of an owner-less Organization", async () => {
    const result = await recovery().assignOwner({
      organizationId: "client",
      user: "ALICE@example.com",
    });

    expect(result).toMatchObject({ userId: "alice", action: "added", applied: true });
    expect(await roleOf(pg, "alice", "client", columns)).toBe("owner");
    expect(await roleOf(pg, "staff", "client", columns)).toBe("admin");
  });

  test("promotes an existing member", async () => {
    const result = await recovery().assignOwner({ organizationId: "client", user: "staff" });

    expect(result.action).toBe("promoted");
    expect(await roleOf(pg, "staff", "client", columns)).toBe("owner");
  });

  test("reports the change without making it on a dry run", async () => {
    const result = await recovery().assignOwner({
      organizationId: "client",
      user: "alice",
      dryRun: true,
    });

    expect(result).toMatchObject({ action: "added", applied: false });
    expect(await roleOf(pg, "alice", "client", columns)).toBeNull();
  });

  test.each([
    ["owned", "alice", "HAS_OWNER"],
    ["personal", "staff", "PERSONAL_ORGANIZATION"],
    ["missing", "alice", "ORGANIZATION_NOT_FOUND"],
    ["client", "nobody@example.com", "USER_NOT_FOUND"],
  ])("refuses Organization %s for %s with %s", async (organizationId, user, code) => {
    await expect(recovery().assignOwner({ organizationId, user })).rejects.toMatchObject({ code });
  });
});
