import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { organizationDaos } from "../../src/db/schema";
import type { OrganizationRole } from "../../src/lib/organizations";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import { type FakeOrganization, inMemoryOrganizations, signedIn } from "../fakes/organizations";
import { applyAllMigrations } from "./_pg";

const DEFAULT_DAO = "multiagency.sputnik-dao.near";
const OTHER_DAO = "other.sputnik-dao.near";
const FORBIDDEN = { code: "FORBIDDEN" };
const NO_CAPABILITIES = {
  canManageMembers: false,
  canUseMoney: false,
  hasAgencySections: false,
  hasClientSections: false,
};

const organizations: FakeOrganization[] = [
  { id: "multiagency", daoAccountId: DEFAULT_DAO },
  { id: "other", daoAccountId: OTHER_DAO },
  { id: "no-dao" },
  { id: "personal", isPersonal: true },
  { id: "odd", isPersonal: true, daoAccountId: OTHER_DAO },
];

const ROLES: OrganizationRole[] = ["owner", "admin", "member", "contributor"];

const members = [
  ...ROLES.map((role) => ({ userId: role, organizationId: "other", role })),
  { userId: "staff", organizationId: "multiagency", role: "member" as const },
  ...["multiagency", "no-dao", "personal", "odd"].map((organizationId) => ({
    userId: "u1",
    organizationId,
    role: "owner" as const,
  })),
];

function outcome(promise: Promise<unknown>) {
  return promise.then(
    () => "allowed",
    (error: { code?: string }) => error.code,
  );
}

describe("organization access", () => {
  let pg: PGlite;
  let db: Database;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE organization_daos");
  });

  afterAll(async () => {
    await pg.close();
  });

  function accessWith(defaultDaoAccountId: string | null = DEFAULT_DAO) {
    return createOrganizationAccess({
      db,
      organizations: inMemoryOrganizations({ organizations, members }).port,
      defaultDaoAccountId: defaultDaoAccountId ?? undefined,
    });
  }

  test("anonymous requests act for the default Agency DAO with no role and no private access", async () => {
    expect(await accessWith().publicScope({})).toMatchObject({
      agencyDao: DEFAULT_DAO,
      network: "mainnet",
      role: null,
      actorId: "unknown",
      canSeePrivate: false,
    });
    await expect(accessWith(null).publicScope({})).rejects.toMatchObject(FORBIDDEN);
  });

  test("signed-in members get their role and their Organization's Agency DAO", async () => {
    const access = accessWith();

    expect(
      await access.agencyScope(signedIn("admin", "other", "boss.near"), ROLE_MATRIX.work),
    ).toMatchObject({
      organizationId: "other",
      agencyDao: OTHER_DAO,
      role: "admin",
      actorId: "boss.near",
      canSeePrivate: true,
    });
    expect((await access.publicScope(signedIn("owner", "other"))).actorId).toBe("owner");
  });

  test.each([
    { role: "owner", canSeePrivate: true, canManageMembers: true, canUseMoney: true, works: true },
    { role: "admin", canSeePrivate: true, canManageMembers: true, canUseMoney: true, works: true },
    {
      role: "member",
      canSeePrivate: false,
      canManageMembers: false,
      canUseMoney: true,
      works: true,
    },
    {
      role: "contributor",
      canSeePrivate: true,
      canManageMembers: false,
      canUseMoney: false,
      works: false,
    },
  ])("$role capabilities and agency routes follow the role matrix", async (row) => {
    const access = accessWith();
    const context = signedIn(row.role, "other");

    expect((await access.resolve(context)).capabilities).toEqual({
      canManageMembers: row.canManageMembers,
      canUseMoney: row.canUseMoney,
      hasAgencySections: row.works,
      hasClientSections: false,
    });
    expect((await access.publicScope(context)).canSeePrivate).toBe(row.canSeePrivate);
    expect(await outcome(access.agencyScope(context, ROLE_MATRIX.work))).toBe(
      row.works ? "allowed" : "FORBIDDEN",
    );
    expect(await outcome(access.agencyScope(context, ROLE_MATRIX.manage))).toBe(
      row.canManageMembers ? "allowed" : "FORBIDDEN",
    );
  });

  test("an owner of a DAO-less Organization keeps their role but never borrows the default Agency DAO", async () => {
    const access = accessWith();
    const context = signedIn("u1", "no-dao");

    const resolved = await access.resolve(context);

    expect(resolved).toMatchObject({ role: "owner", agencyDao: null });
    expect(resolved.capabilities).toEqual({
      ...NO_CAPABILITIES,
      canManageMembers: true,
      hasAgencySections: true,
    });
    await expect(access.agencyScope(context, ROLE_MATRIX.manage)).rejects.toMatchObject(FORBIDDEN);
    expect(await access.publicScope(context)).toMatchObject({
      agencyDao: DEFAULT_DAO,
      role: null,
      canSeePrivate: false,
    });
  });

  test.each([
    "personal",
    "odd",
  ])("a personal Organization (%s) gives its owner no role and no Agency DAO", async (organizationId) => {
    const access = accessWith();
    const context = signedIn("u1", organizationId);

    expect(await access.resolve(context)).toMatchObject({
      role: null,
      agencyDao: null,
      capabilities: NO_CAPABILITIES,
    });
    await expect(access.agencyScope(context, ROLE_MATRIX.work)).rejects.toMatchObject(FORBIDDEN);
  });

  test("a DAO mapped to another Organization is not granted from metadata", async () => {
    await db
      .insert(organizationDaos)
      .values({ organizationId: "other", daoAccountId: DEFAULT_DAO });

    expect((await accessWith().resolve(signedIn("u1", "multiagency"))).agencyDao).toBeNull();
  });

  test("the mapping takes precedence over Organization metadata", async () => {
    await db
      .insert(organizationDaos)
      .values({ organizationId: "no-dao", daoAccountId: "mapped.sputnik-dao.near" });

    expect(
      (await accessWith().agencyScope(signedIn("u1", "no-dao"), ROLE_MATRIX.manage)).agencyDao,
    ).toBe("mapped.sputnik-dao.near");
  });

  test("only members of the default Organization pass the default Organization check", async () => {
    const access = accessWith();
    const staff = await access.agencyScope(signedIn("staff", "multiagency"), ROLE_MATRIX.work);
    const outsider = await access.agencyScope(signedIn("owner", "other"), ROLE_MATRIX.work);

    expect(() => access.requireDefaultOrganization(staff)).not.toThrow();
    expect(() => access.requireDefaultOrganization(outsider)).toThrow(
      expect.objectContaining(FORBIDDEN),
    );
  });
});
