import { describe, expect, test } from "vitest";
import { isDefaultOrganizationStaff, needsTreasury } from "../src/lib/treasury";

describe("needsTreasury", () => {
  test("recognises the API refusing money features without an Agency DAO", () => {
    expect(needsTreasury({ code: "FORBIDDEN", data: { reason: "NO_AGENCY_DAO" } })).toBe(true);
  });

  test("ignores other access errors", () => {
    expect(needsTreasury({ code: "FORBIDDEN", data: { requiredRoles: ["owner"] } })).toBe(false);
    expect(needsTreasury(new Error("boom"))).toBe(false);
    expect(needsTreasury(undefined)).toBe(false);
  });
});

describe("isDefaultOrganizationStaff", () => {
  const DEFAULT_DAO = "multiagency.sputnik-dao.near";

  test("is true only for owners and admins of the default Organization", () => {
    expect(isDefaultOrganizationStaff(true, DEFAULT_DAO, DEFAULT_DAO)).toBe(true);
    expect(isDefaultOrganizationStaff(false, DEFAULT_DAO, DEFAULT_DAO)).toBe(false);
    expect(isDefaultOrganizationStaff(true, "other.sputnik-dao.near", DEFAULT_DAO)).toBe(false);
    expect(isDefaultOrganizationStaff(true, null, DEFAULT_DAO)).toBe(false);
    expect(isDefaultOrganizationStaff(true, null, null)).toBe(false);
  });
});
