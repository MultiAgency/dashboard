import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { authDatabaseDirectory, authDatabaseMembers } from "../../src/lib/auth-database";

const NAMINGS = {
  camelCase: (camel: string) => camel,
  snake_case: (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
};

async function betterAuthDatabase(name: (camel: string) => string) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite("memory://");
  const nearAccount = name("nearAccount");
  await pg.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE);
    CREATE TABLE "organization" (
      id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE, logo text, metadata text,
      "${name("createdAt")}" timestamp NOT NULL
    );
    CREATE TABLE "member" (
      id text PRIMARY KEY,
      "${name("organizationId")}" text NOT NULL REFERENCES "organization"(id),
      "${name("userId")}" text NOT NULL REFERENCES "user"(id),
      role text NOT NULL,
      "${name("createdAt")}" timestamp NOT NULL
    );
    CREATE TABLE "invitation" (
      id text PRIMARY KEY,
      "${name("organizationId")}" text NOT NULL REFERENCES "organization"(id),
      email text NOT NULL,
      role text,
      status text NOT NULL,
      "${name("expiresAt")}" timestamptz NOT NULL,
      "${name("inviterId")}" text NOT NULL REFERENCES "user"(id),
      "${name("createdAt")}" timestamp NOT NULL
    );
    CREATE TABLE "${nearAccount}" (
      id text PRIMARY KEY,
      "${name("userId")}" text NOT NULL REFERENCES "user"(id),
      "${name("accountId")}" text NOT NULL
    );
    INSERT INTO "user" VALUES
      ('owner', 'Owner', 'owner@acme.example'),
      ('admin', 'Admin', 'admin.near@near.email'),
      ('viewer', 'Viewer', 'viewer@acme.example');
    INSERT INTO "organization" VALUES
      ('acme', 'Acme Corp', 'acme', null, '{}', now()),
      ('personal', 'Owner', 'owner', null, '{"isPersonal":true}', now());
    INSERT INTO "member" VALUES
      ('m1', 'acme', 'owner', 'owner', now()),
      ('m2', 'acme', 'admin', 'admin', now()),
      ('m3', 'acme', 'viewer', 'member', now()),
      ('m4', 'personal', 'owner', 'owner', now());
    INSERT INTO "${nearAccount}" VALUES ('n1', 'admin', 'admin.near');
  `);
  return pg;
}

describe.each(Object.entries(NAMINGS))("auth directory on a %s auth database", (_, name) => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await betterAuthDatabase(name);
  });

  afterEach(async () => {
    await pg.close();
  });

  test("finds Organizations by slug and names their owners and admins with deliverable emails", async () => {
    const directory = authDatabaseDirectory(pg);

    expect(await directory.findBySlug("ACME")).toMatchObject({
      id: "acme",
      name: "Acme Corp",
      isPersonal: false,
    });
    expect((await directory.findBySlug("owner"))?.isPersonal).toBe(true);
    expect(await directory.findBySlug("nobody")).toBeNull();
    expect(
      (await directory.managers("acme")).sort((a, b) => a.userId.localeCompare(b.userId)),
    ).toEqual([
      { userId: "admin", role: "admin", email: null },
      { userId: "owner", role: "owner", email: "owner@acme.example" },
    ]);
    expect(
      (await directory.memberships("owner")).map((m) => [m.organization.id, m.role]).sort(),
    ).toEqual([
      ["acme", "owner"],
      ["personal", "owner"],
    ]);
  });

  test("names one member of an Organization with their role and deliverable email", async () => {
    const directory = authDatabaseDirectory(pg);

    expect(await directory.member("acme", "viewer")).toEqual({
      userId: "viewer",
      role: "member",
      email: "viewer@acme.example",
    });
    expect(await directory.member("acme", "admin")).toEqual({
      userId: "admin",
      role: "admin",
      email: null,
    });
    expect(await directory.member("personal", "viewer")).toBeNull();
  });

  test("creates an Organization with no members and invites its first admin as owner", async () => {
    const directory = authDatabaseDirectory(pg);

    const created = await directory.create({ name: "Newco", slug: "newco" });
    const expiresAt = new Date("2030-01-01T00:00:00Z");
    const invitation = await directory.invite({
      organizationId: created.id,
      email: "Boss@Newco.example",
      role: "owner",
      inviterId: "owner",
      expiresAt,
    });

    expect(created).toMatchObject({ name: "Newco", slug: "newco", isPersonal: false });
    expect(await directory.managers(created.id)).toEqual([]);
    expect(await directory.invitation(invitation.id)).toEqual({
      id: invitation.id,
      organizationId: created.id,
      email: "boss@newco.example",
      role: "owner",
      status: "pending",
      expiresAt,
    });
    await expect(directory.create({ name: "Again", slug: "NEWCO" })).rejects.toThrow(/taken/);

    await directory.updateInvitation(invitation.id, { status: "canceled" });
    expect((await directory.invitation(invitation.id))?.status).toBe("canceled");
  });

  test("finds wallet users by NEAR account and removes members", async () => {
    const members = authDatabaseMembers(pg);

    expect(await members.findUserIdByNearAccount("admin.near")).toBe("admin");
    expect(await members.findUserIdByNearAccount("stranger.near")).toBeNull();
    await members.removeMember({ memberId: "m2" });
    expect((await members.roster("acme"))?.members.map((m) => m.userId).sort()).toEqual([
      "owner",
      "viewer",
    ]);
  });
});
