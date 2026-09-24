import { beforeEach, describe, expect, test } from "vitest";
import { engagementProjects, engagements, organizationDaos } from "../../src/db/schema";
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
    await database.pg.query("TRUNCATE organization_daos, engagements CASCADE");
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
    expect(
      (await access.agencyScope(signedIn("member", "other"), ROLE_MATRIX.work)).canSeePrivate,
    ).toBe(true);
  });

  test.each([
    { role: "owner", manages: true, money: true, works: true },
    { role: "admin", manages: true, money: true, works: true },
    { role: "member", manages: false, money: true, works: true },
    { role: "contributor", manages: false, money: false, works: false },
  ])("$role capabilities and agency routes follow the role matrix", async (row) => {
    const access = accessWith();
    const context = signedIn(row.role, "other");

    expect((await access.resolve(context)).capabilities).toEqual({
      canManageMembers: row.manages,
      canUseMoney: row.money,
      hasAgencySections: row.works,
      hasClientSections: false,
    });
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
      agencyDao: DEFAULT_DAO,
      role: null,
      canSeePrivate: false,
    });
  });

  test("a DAO-less Organization follows the dashboard network toggle", async () => {
    const context = {
      ...signedIn("u1", "no-dao"),
      reqHeaders: new Headers({ cookie: "current_near_network=testnet" }),
    };

    expect((await accessWith().agencyScope(context, ROLE_MATRIX.work)).network).toBe("testnet");
  });

  test("the default Organization is the one mapped to the default Agency DAO", async () => {
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
    await database.pg.query("TRUNCATE organization_daos, engagements CASCADE");

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

  test("an active or ended Engagement gives the Client Organization its Client sections", async () => {
    await database.db.insert(engagements).values([
      {
        id: "as-client",
        agencyOrganizationId: "other",
        clientOrganizationId: "multiagency",
        status: "active",
        proposedBy: "x",
      },
      {
        id: "as-subcontractor",
        agencyOrganizationId: "other",
        clientOrganizationId: "no-dao",
        kind: "subcontract",
        status: "ended",
        proposedBy: "x",
      },
    ]);
    const access = accessWith();

    for (const organizationId of ["multiagency", "no-dao"]) {
      expect((await access.resolve(signedIn("u1", organizationId))).capabilities).toMatchObject({
        hasClientSections: true,
      });
    }
  });

  test("a proposed Engagement gives no Client sections and no shared reads", async () => {
    await database.db.insert(engagements).values({
      id: "pending",
      agencyOrganizationId: "other",
      clientOrganizationId: "multiagency",
      status: "proposed",
      proposedBy: "x",
    });
    await database.db
      .insert(engagementProjects)
      .values({ engagementId: "pending", projectId: "foreign" });
    const access = accessWith();
    const context = signedIn("u1", "multiagency");

    expect((await access.resolve(context)).capabilities.hasClientSections).toBe(false);
    await expect(access.sharedWith(context, "pending")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
