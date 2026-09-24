import { describe, expect, test } from "vitest";
import { needsTreasury } from "../src/lib/treasury";

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
