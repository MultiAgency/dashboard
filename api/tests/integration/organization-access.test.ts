import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { organizationDaos } from "../../src/db/schema";
import { createOrganizationAccess, ROLE_MATRIX } from "../../src/services/organization-access";
import { createProjectDirectory } from "../../src/services/project-directory";
import {
  type FakeMember,
  type FakeOrganization,
  inMemoryOrganizations,
  signedIn,
} from "../fakes/organizations";
import { inMemoryProjects, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const DEFAULT_DAO = "multiagency.sputnik-dao.near";
const OTHER_DAO = "other.sputnik-dao.near";

describe("organization access", () => {
  let pg: PGlite;
  let db: Database;
  const directory = createProjectDirectory(
    () => inMemoryProjects([project("owned", DEFAULT_DAO), project("foreign", OTHER_DAO)]).client,
  );

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

  const organizations: FakeOrganization[] = [
    { id: "multiagency", daoAccountId: DEFAULT_DAO },
    { id: "other", daoAccountId: OTHER_DAO },
    { id: "no-dao" },
    { id: "personal", isPersonal: true },
  ];

  function accessWith(
    members: FakeMember[],
    options: { defaultDaoAccountId?: string; orgs?: FakeOrganization[] } = {},
  ) {
    return createOrganizationAccess({
      db,
      organizations: inMemoryOrganizations({
        organizations: options.orgs ?? organizations,
        members,
      }).port,
      directory,
      defaultDaoAccountId:
        "defaultDaoAccountId" in options ? options.defaultDaoAccountId : DEFAULT_DAO,
    });
  }

  describe("anonymous requests", () => {
    test("act for the default Agency DAO with no role and no private access", async () => {
      const scope = await accessWith([]).publicScope({});

      expect(scope).toMatchObject({
        agencyDao: DEFAULT_DAO,
        network: "mainnet",
        role: null,
        actorId: "unknown",
        canSeePrivate: false,
      });
    });

    test("are refused when the deployment has no default Agency DAO", async () => {
      await expect(
        accessWith([], { defaultDaoAccountId: undefined }).publicScope({}),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("signed-in members", () => {
    test("get their role and their Organization's Agency DAO", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "other", role: "admin" }]);

      const scope = await access.agencyScope(
        signedIn("u1", "other", "boss.near"),
        ROLE_MATRIX.work,
      );

      expect(scope).toMatchObject({
        organizationId: "other",
        agencyDao: OTHER_DAO,
        role: "admin",
        actorId: "boss.near",
        canSeePrivate: true,
      });
    });

    test("act as their user id when no NEAR account is linked", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "other", role: "owner" }]);

      expect((await access.publicScope(signedIn("u1", "other"))).actorId).toBe("u1");
    });

    test("plain members cannot see private projects but contributors can", async () => {
      const access = accessWith([
        { userId: "m", organizationId: "other", role: "member" },
        { userId: "c", organizationId: "other", role: "contributor" },
      ]);

      expect((await access.publicScope(signedIn("m", "other"))).canSeePrivate).toBe(false);
      expect((await access.publicScope(signedIn("c", "other"))).canSeePrivate).toBe(true);
    });

    test("are refused agency routes their role does not allow", async () => {
      const access = accessWith([
        { userId: "m", organizationId: "other", role: "member" },
        { userId: "c", organizationId: "other", role: "contributor" },
      ]);

      await expect(
        access.agencyScope(signedIn("m", "other"), ROLE_MATRIX.manage),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        access.agencyScope(signedIn("c", "other"), ROLE_MATRIX.work),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await access.agencyScope(signedIn("m", "other"), ROLE_MATRIX.work)).role).toBe(
        "member",
      );
    });
  });

  describe("role resolution without a DAO", () => {
    test("an owner of a DAO-less Organization keeps their role but has no Agency DAO", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "no-dao", role: "owner" }]);

      const resolved = await access.resolve(signedIn("u1", "no-dao"));

      expect(resolved).toMatchObject({ role: "owner", agencyDao: null });
      expect(resolved.capabilities).toEqual({
        canManageMembers: true,
        canUseMoney: false,
        hasAgencySections: true,
        hasClientSections: false,
      });
    });

    test("a DAO-less Organization never borrows the default Agency DAO for agency routes", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "no-dao", role: "owner" }]);

      await expect(
        access.agencyScope(signedIn("u1", "no-dao"), ROLE_MATRIX.manage),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("a DAO-less Organization sees public pages exactly like an anonymous visitor", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "no-dao", role: "owner" }]);

      expect(await access.publicScope(signedIn("u1", "no-dao"))).toMatchObject({
        agencyDao: DEFAULT_DAO,
        role: null,
        canSeePrivate: false,
      });
    });
  });

  describe("personal Organizations", () => {
    test("give their owner no Agency or Client role", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "personal", role: "owner" }]);

      const resolved = await access.resolve(signedIn("u1", "personal"));

      expect(resolved.role).toBeNull();
      expect(resolved.capabilities).toEqual({
        canManageMembers: false,
        canUseMoney: false,
        hasAgencySections: false,
        hasClientSections: false,
      });
      await expect(
        access.agencyScope(signedIn("u1", "personal"), ROLE_MATRIX.work),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("never get an Agency DAO even when their metadata names one", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "odd", role: "owner" }], {
        orgs: [{ id: "odd", isPersonal: true, daoAccountId: OTHER_DAO }],
      });

      expect((await access.resolve(signedIn("u1", "odd"))).agencyDao).toBeNull();
    });
  });

  describe("capabilities", () => {
    test("follow the role matrix for every role", async () => {
      const access = accessWith([
        { userId: "owner", organizationId: "other", role: "owner" },
        { userId: "admin", organizationId: "other", role: "admin" },
        { userId: "member", organizationId: "other", role: "member" },
        { userId: "contributor", organizationId: "other", role: "contributor" },
      ]);
      const capabilitiesOf = async (userId: string) =>
        (await access.resolve(signedIn(userId, "other"))).capabilities;

      expect(await capabilitiesOf("owner")).toEqual({
        canManageMembers: true,
        canUseMoney: true,
        hasAgencySections: true,
        hasClientSections: false,
      });
      expect(await capabilitiesOf("admin")).toEqual(await capabilitiesOf("owner"));
      expect(await capabilitiesOf("member")).toEqual({
        canManageMembers: false,
        canUseMoney: true,
        hasAgencySections: true,
        hasClientSections: false,
      });
      expect(await capabilitiesOf("contributor")).toEqual({
        canManageMembers: false,
        canUseMoney: false,
        hasAgencySections: false,
        hasClientSections: false,
      });
    });
  });

  describe("Agency DAO mapping", () => {
    test("a DAO mapped to another Organization is not granted from metadata", async () => {
      await db
        .insert(organizationDaos)
        .values({ organizationId: "other", daoAccountId: DEFAULT_DAO });
      const access = accessWith([{ userId: "u1", organizationId: "multiagency", role: "owner" }]);

      expect((await access.resolve(signedIn("u1", "multiagency"))).agencyDao).toBeNull();
    });

    test("the mapping takes precedence over Organization metadata", async () => {
      await db
        .insert(organizationDaos)
        .values({ organizationId: "no-dao", daoAccountId: "mapped.sputnik-dao.near" });
      const access = accessWith([{ userId: "u1", organizationId: "no-dao", role: "admin" }]);

      expect(
        (await access.agencyScope(signedIn("u1", "no-dao"), ROLE_MATRIX.manage)).agencyDao,
      ).toBe("mapped.sputnik-dao.near");
    });
  });

  describe("default Organization", () => {
    test("only its members pass the default Organization check", async () => {
      const access = accessWith([
        { userId: "staff", organizationId: "multiagency", role: "member" },
        { userId: "outsider", organizationId: "other", role: "owner" },
      ]);

      const staff = await access.agencyScope(signedIn("staff", "multiagency"), ROLE_MATRIX.work);
      const outsider = await access.agencyScope(signedIn("outsider", "other"), ROLE_MATRIX.work);

      expect(() => access.requireDefaultOrganization(staff)).not.toThrow();
      expect(() => access.requireDefaultOrganization(outsider)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    });
  });

  describe("projects and engagements", () => {
    test("a project is owned only when it belongs to the active Organization's Agency", async () => {
      const access = accessWith([{ userId: "u1", organizationId: "multiagency", role: "admin" }]);
      const scope = await access.agencyScope(signedIn("u1", "multiagency"), ROLE_MATRIX.work);

      expect(await access.projectRelation(scope, "owned")).toBe("owned");
      expect(await access.projectRelation(scope, "foreign")).toBeNull();
      expect(await access.projectRelation(scope, "missing")).toBeNull();
    });
  });
});
