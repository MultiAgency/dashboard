import { describe, expect, test } from "vitest";
import { actorOf } from "../../src/services/organization-access";

describe("actorOf", () => {
  test("a signed-in user with a NEAR account acts as that account, otherwise as their user id", () => {
    expect(actorOf({ userId: "user-1", near: { primaryAccountId: "alice.near" } })).toBe(
      "alice.near",
    );
    expect(actorOf({ userId: "user-1", near: null })).toBe("user-1");
    expect(actorOf({ userId: "user-1", near: { primaryAccountId: null } })).toBe("user-1");
  });
});
