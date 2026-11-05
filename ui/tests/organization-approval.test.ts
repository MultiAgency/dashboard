import { describe, expect, test } from "vitest";
import { isActiveOrganization, organizationToActivate } from "../src/lib/landing";

const live = { id: "live", metadata: null, status: "active" };
const asked = { id: "asked", metadata: null, status: "pending" };
const refused = { id: "refused", metadata: null, status: "rejected" };

describe("organizations waiting for approval", () => {
  test("are never activated, even when they are the session's active one", () => {
    expect(organizationToActivate("asked", [asked, live])).toBe("live");
    expect(organizationToActivate(null, [asked, refused])).toBeNull();
  });

  test("can be activated once approved", () => {
    expect(organizationToActivate("asked", [{ ...asked, status: "active" }, live])).toBe("asked");
  });

  test("stay unusable when rejected", () => {
    expect(organizationToActivate("refused", [refused, live])).toBe("live");
    expect(isActiveOrganization(refused)).toBe(false);
  });

  test("an auth server without approval reports no status and everything is active", () => {
    expect(isActiveOrganization({})).toBe(true);
  });
});
