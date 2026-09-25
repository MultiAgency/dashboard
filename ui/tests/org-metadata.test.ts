import { describe, expect, test } from "vitest";
import { isAgencyWorkspace } from "../src/lib/org-metadata";

describe("isAgencyWorkspace", () => {
  test("offers Organizations without an Agency DAO or type in the switcher", () => {
    expect(isAgencyWorkspace({})).toBe(true);
    expect(isAgencyWorkspace(null)).toBe(true);
    expect(isAgencyWorkspace({ daoAccountId: "x.sputnik-dao.near" })).toBe(true);
    expect(isAgencyWorkspace(JSON.stringify({ type: "agency" }))).toBe(true);
  });

  test("leaves out personal Organizations and legacy Client Organizations", () => {
    expect(isAgencyWorkspace({ isPersonal: true })).toBe(false);
    expect(isAgencyWorkspace({ type: "client" })).toBe(false);
  });
});
