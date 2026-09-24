import { beforeEach, describe, expect, test } from "vitest";
import { organizationDaos } from "../../src/db/schema";
import {
  NO_AGENCY_DAO,
  ROLE_MATRIX,
  requireTreasury,
} from "../../src/services/organization-access";
import {
  type FakeMember,
  type FakeOrganization,
  inMemoryAccess,
  seedAgencyDaos,
  signedIn,
} from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

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

const members: FakeMember[] = [
  { userId: "owner", organizationId: "other", role: "owner" },
  { userId: "admin", organizationId: "other", role: "admin" },
  { userId: "member", organizationId: "other", role: "member" },
  { userId: "contributor", organizationId: "other", role: "contributor" },
  { userId: "staff", organizationId: "multiagency", role: "member" },
  { userId: "u1", organizationId: "multiagency", role: "owner" },
  { userId: "u1", organizationId: "no-dao", role: "owner" },
  { userId: "u1", organizationId: "personal", role: "owner" },
  { userId: "u1", organizationId: "odd", role: "owner" },
];

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => "allowed",
    (e: { code?: string }) => e.code,
  );

describe("organization access", () => {
  const database = migratedDatabase();

  beforeEach(async () => {
    await database.pg.query("TRUNCATE organization_daos");
    await seedAgencyDaos(database.db, organizations);
  });

  const accessWith = (defaultDao: string | null = DEFAULT_DAO) =>
    inMemoryAccess(database.db, { organizations, members }, defaultDao ?? undefined);

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
    { role: "owner", manages: true, money: true, works: true, seesPrivate: true },
    { role: "admin", manages: true, money: true, works: true, seesPrivate: true },
    { role: "member", manages: false, money: true, works: true, seesPrivate: true },
    { role: "contributor", manages: false, money: false, works: false, seesPrivate: true },
  ])("$role capabilities and agency routes follow the role matrix", async (row) => {
    const access = accessWith();
    const context = signedIn(row.role, "other");

    expect((await access.resolve(context)).capabilities).toEqual({
      canManageMembers: row.manages,
      canUseMoney: row.money,
      hasAgencySections: row.works,
      hasClientSections: false,
    });
    expect((await access.publicScope(context)).canSeePrivate).toBe(row.seesPrivate);
    expect(await outcome(access.agencyScope(context, ROLE_MATRIX.work))).toBe(
      row.works ? "allowed" : "FORBIDDEN",
    );
    expect(await outcome(access.agencyScope(context, ROLE_MATRIX.manage))).toBe(
      row.manages ? "allowed" : "FORBIDDEN",
    );
  });

  test("an owner of a DAO-less Organization gets agency routes but never borrows the default Agency DAO", async () => {
    const access = accessWith();
    const context = signedIn("u1", "no-dao");

    const resolved = await access.resolve(context);

    expect(resolved).toMatchObject({ role: "owner", agencyDao: null });
    expect(resolved.capabilities).toEqual({
      ...NO_CAPABILITIES,
      canManageMembers: true,
      hasAgencySections: true,
    });
    const scope = await access.agencyScope(context, ROLE_MATRIX.manage);
    expect(scope).toMatchObject({ organizationId: "no-dao", agencyDao: null, role: "owner" });
    expect(() => requireTreasury(scope)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", data: { reason: NO_AGENCY_DAO } }),
    );
    expect(await access.publicScope(context)).toMatchObject({
      organizationId: "no-dao",
      agencyDao: null,
      role: "owner",
    });
  });

  test("a DAO-less Organization follows the dashboard network toggle", async () => {
    const context = {
      ...signedIn("u1", "no-dao"),
      reqHeaders: new Headers({ cookie: "current_near_network=testnet" }),
    };

    expect((await accessWith().publicScope(context)).network).toBe("testnet");
  });

  test("anonymous visitors resolve the Organization mapped to the default Agency DAO", async () => {
    expect(await accessWith().publicScope({})).toMatchObject({
      organizationId: "multiagency",
      agencyDao: DEFAULT_DAO,
      role: null,
    });
    expect(await accessWith().defaultOrganization()).toEqual({
      organizationId: "multiagency",
      agencyDao: DEFAULT_DAO,
    });
  });

  test.each([
    "personal",
    "odd",
  ])("a personal Organization (%s) gives its owner no role and no Agency DAO, even when one is connected", async (organizationId) => {
    await database.db
      .insert(organizationDaos)
      .values({ organizationId, daoAccountId: `${organizationId}.sputnik-dao.near` });
    const access = accessWith();
    const context = signedIn("u1", organizationId);

    expect(await access.resolve(context)).toMatchObject({
      role: null,
      agencyDao: null,
      capabilities: NO_CAPABILITIES,
    });
    await expect(access.agencyScope(context, ROLE_MATRIX.work)).rejects.toMatchObject(FORBIDDEN);
    expect(await access.publicScope(context)).toMatchObject({
      agencyDao: DEFAULT_DAO,
      role: null,
      canSeePrivate: false,
    });
  });

  test("Organization metadata naming a DAO grants no Agency DAO without a connection", async () => {
    await database.pg.query("TRUNCATE organization_daos");

    expect((await accessWith().resolve(signedIn("owner", "other"))).agencyDao).toBeNull();
  });

  test("a connected DAO is the Organization's Agency DAO", async () => {
    await database.db
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
