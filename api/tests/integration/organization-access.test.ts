import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { AGENCY_MANAGER_ROLES, AGENCY_MEMBER_ROLES } from "../../src/lib/agency-scope";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import { inMemoryOrganizations, memberContext } from "../fakes/organizations";
import { applyAllMigrations } from "./_pg";

const DAO = "multiagency.sputnik-dao.near";

describe("organization access", () => {
  let pg: PGlite;
  let db: Database;

  const multiagency = {
    id: "org-multiagency",
    daoAccountId: DAO,
    members: { alice: "admin" as const, bob: "member" as const },
  };
  const impostor = { id: "org-testing", daoAccountId: DAO, members: { eve: "owner" as const } };
  const indie = { id: "org-indie", daoAccountId: null, members: { ivy: "owner" as const } };

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

  const access = () =>
    createOrganizationAccess(
      db,
      inMemoryOrganizations([multiagency, impostor, indie]).organizations,
    );

  test("a member acts for the active Organization with its Agency DAO and role", async () => {
    const scope = await access().scope(memberContext(multiagency, "alice"));

    expect(scope).toMatchObject({
      organizationId: "org-multiagency",
      agencyDao: DAO,
      role: "admin",
      canSeePrivate: true,
    });
  });

  test("required roles are enforced", async () => {
    await expect(
      access().scope(memberContext(multiagency, "bob"), AGENCY_MANAGER_ROLES),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an Agency DAO belongs to only one Organization", async () => {
    const shared = access();
    await shared.scope(memberContext(multiagency, "alice"));

    await expect(shared.scope(memberContext(impostor, "eve"))).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("already linked to another Organization"),
    });
    await expect(access().scope(memberContext(impostor, "eve"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("another Organization's Agency DAO can be looked up", async () => {
    const a = access();
    expect(await a.daoOf("org-multiagency")).toBe(DAO);
    expect(await a.daoOf("org-indie")).toBeNull();
    expect(await a.daoOf("org-unknown")).toBeNull();
  });

  test("an Organization without an Agency DAO works on Projects but not on money", async () => {
    const context = memberContext(indie, "ivy");

    expect(await access().orgScope(context, AGENCY_MEMBER_ROLES)).toMatchObject({
      organizationId: "org-indie",
      agencyDao: null,
      role: "owner",
    });
    await expect(access().scope(context, AGENCY_MEMBER_ROLES)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("Connect a treasury"),
    });
  });
});
