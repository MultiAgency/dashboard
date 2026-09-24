import { describe, expect, test } from "vitest";
import { canChangeRole, isLastOwner, memberDisplayName, realEmail } from "../src/lib/membership";

describe("memberDisplayName", () => {
  test("prefers the member's name", () => {
    expect(memberDisplayName({ userId: "u1", name: "Alice", email: "alice@example.com" })).toBe(
      "Alice",
    );
  });

  test("falls back to the email for email users without a name", () => {
    expect(memberDisplayName({ userId: "u1", name: "  ", email: "alice@example.com" })).toBe(
      "alice@example.com",
    );
  });

  test("falls back to the NEAR account behind a wallet placeholder email", () => {
    expect(memberDisplayName({ userId: "u1", name: null, email: "alice@near.email" })).toBe(
      "alice.near",
    );
  });

  test("falls back to the user id when nothing else identifies the member", () => {
    expect(
      memberDisplayName({ userId: "u1", name: null, email: "temp-1a2b3c4d@multiagency.near" }),
    ).toBe("u1");
  });
});

describe("realEmail", () => {
  test("keeps an address a person can receive mail at", () => {
    expect(realEmail("alice@example.com")).toBe("alice@example.com");
  });

  test("hides placeholder addresses created for NEAR wallet sign-ins", () => {
    expect(realEmail("alice@near.email")).toBeNull();
    expect(realEmail("temp-1a2b3c4d@multiagency.sputnik-dao.near")).toBeNull();
    expect(realEmail(null)).toBeNull();
  });
});

describe("last owner guard", () => {
  const soleOwner = [
    { id: "m1", userId: "u1", role: "owner" },
    { id: "m2", userId: "u2", role: "admin" },
  ];
  const twoOwners = [
    { id: "m1", userId: "u1", role: "owner" },
    { id: "m2", userId: "u2", role: "owner" },
  ];

  test("the only owner is the last owner; admins never are", () => {
    expect(isLastOwner(soleOwner, "m1")).toBe(true);
    expect(isLastOwner(soleOwner, "m2")).toBe(false);
  });

  test("no owner is the last owner while another owner remains", () => {
    expect(isLastOwner(twoOwners, "m1")).toBe(false);
  });

  test("the last owner cannot be demoted but can keep the owner role", () => {
    expect(canChangeRole(soleOwner, "m1", "admin")).toBe(false);
    expect(canChangeRole(soleOwner, "m1", "owner")).toBe(true);
  });

  test("other members can move to any role", () => {
    expect(canChangeRole(soleOwner, "m2", "member")).toBe(true);
    expect(canChangeRole(twoOwners, "m1", "member")).toBe(true);
  });
});
