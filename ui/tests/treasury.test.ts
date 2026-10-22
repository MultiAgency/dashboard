import { describe, expect, test } from "vitest";
import { agentHeldView, isDefaultOrganizationStaff, needsTreasury } from "../src/lib/treasury";

describe("needsTreasury", () => {
  test("recognises only the API refusing money features without an Agency DAO", () => {
    expect(needsTreasury({ code: "FORBIDDEN", data: { reason: "NO_AGENCY_DAO" } })).toBe(true);
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

describe("agentHeldView", () => {
  const idle = { isLoading: false, isError: false };

  test("shows loading while the read is in flight", () => {
    expect(agentHeldView(undefined, { isLoading: true, isError: false })).toEqual({
      kind: "loading",
    });
  });

  test("an unconfigured source is unavailable, not zero", () => {
    const view = agentHeldView({ status: "unavailable", reason: "not-configured" }, idle);
    expect(view.kind).toBe("unavailable");
  });

  test("a failed request is unavailable, never an empty or zero balance", () => {
    expect(agentHeldView(undefined, { isLoading: false, isError: true }).kind).toBe("unavailable");
    expect(agentHeldView(undefined, idle).kind).toBe("unavailable");
  });

  test("an empty reading is distinct from unavailable", () => {
    const view = agentHeldView({ status: "available", balances: [], updatedAt: "t" }, idle);
    expect(view).toEqual({ kind: "empty", updatedAt: "t" });
  });

  test("balances pass through with their update time", () => {
    const balances = [{ tokenId: "usdc", balance: "5" }];
    const view = agentHeldView({ status: "available", balances, updatedAt: "t" }, idle);
    expect(view).toEqual({ kind: "balances", balances, updatedAt: "t" });
  });
});
