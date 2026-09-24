import { describe, expect, test } from "vitest";
import { organizationHome, organizationToActivate, safeRedirect } from "../src/lib/landing";

const personal = { id: "me", metadata: { isPersonal: true } };
const agency = { id: "agency", metadata: { daoAccountId: "x.sputnik-dao.near" } };
const plain = { id: "plain", metadata: null };

describe("organizationToActivate", () => {
  test("keeps the active Organization when it is not personal", () => {
    expect(organizationToActivate("plain", [personal, agency, plain])).toBe("plain");
  });

  test("moves off a personal active Organization to the first real one", () => {
    expect(organizationToActivate("me", [personal, agency, plain])).toBe("agency");
  });

  test("picks the first real Organization when none is active", () => {
    expect(organizationToActivate(null, [personal, plain])).toBe("plain");
  });

  test("returns nothing when the user only has their personal Organization", () => {
    expect(organizationToActivate("me", [personal])).toBeNull();
    expect(organizationToActivate(null, [])).toBeNull();
  });

  test("ignores an active id the user is no longer a member of", () => {
    expect(organizationToActivate("gone", [personal, agency])).toBe("agency");
  });
});

describe("organizationHome", () => {
  const none = { canManageMembers: false, hasAgencySections: false, hasClientSections: false };

  test("owners and admins land on the Agency admin sections", () => {
    expect(organizationHome({ ...none, canManageMembers: true, hasAgencySections: true })).toBe(
      "/admin",
    );
  });

  test("members land on the Agency dashboard", () => {
    expect(organizationHome({ ...none, hasAgencySections: true })).toBe("/dashboard");
  });

  test("users with only Client-side access land on the Client sections", () => {
    expect(organizationHome({ ...none, hasClientSections: true })).toBe("/client");
  });

  test("roles without sections land on their profile", () => {
    expect(organizationHome(none)).toBe("/profile");
  });
});

describe("safeRedirect", () => {
  test("keeps same-site paths with their query", () => {
    expect(safeRedirect("/accept-invitation/abc?x=1")).toBe("/accept-invitation/abc?x=1");
  });

  test("rejects other sites and non-paths", () => {
    expect(safeRedirect("https://evil.example")).toBeNull();
    expect(safeRedirect("//evil.example/path")).toBeNull();
    expect(safeRedirect("/\\evil.example")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });
});
