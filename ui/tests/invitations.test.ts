import { describe, expect, test } from "vitest";
import { classifyInvitation, pendingInvitations } from "../src/lib/invitations";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const LATER = "2026-10-01T00:00:00.000Z";
const EARLIER = "2026-09-20T00:00:00.000Z";

describe("classifyInvitation", () => {
  test("asks signed-out visitors to sign up or sign in", () => {
    expect(classifyInvitation({ signedIn: false, now: NOW })).toBe("signed-out");
  });

  test("a pending invitation for the signed-in person can be answered", () => {
    expect(
      classifyInvitation({
        signedIn: true,
        invitation: { status: "pending", expiresAt: LATER },
        now: NOW,
      }),
    ).toBe("pending");
  });

  test("an invitation past its expiry is expired", () => {
    expect(
      classifyInvitation({
        signedIn: true,
        invitation: { status: "pending", expiresAt: EARLIER },
        now: NOW,
      }),
    ).toBe("expired");
  });

  test("answered invitations report their answer", () => {
    const base = { signedIn: true, now: NOW };
    expect(
      classifyInvitation({ ...base, invitation: { status: "rejected", expiresAt: LATER } }),
    ).toBe("declined");
    expect(
      classifyInvitation({ ...base, invitation: { status: "accepted", expiresAt: LATER } }),
    ).toBe("accepted");
    expect(
      classifyInvitation({ ...base, invitation: { status: "canceled", expiresAt: LATER } }),
    ).toBe("unavailable");
  });

  test("an invitation for another email is a mismatch", () => {
    expect(
      classifyInvitation({
        signedIn: true,
        error: { status: 403, code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" },
        now: NOW,
      }),
    ).toBe("wrong-email");
  });

  test("an unverified email must be verified first", () => {
    expect(
      classifyInvitation({
        signedIn: true,
        error: { status: 403, code: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION" },
        now: NOW,
      }),
    ).toBe("verify-email");
  });

  test("an expired, declined or used invitation the server no longer returns is unavailable", () => {
    expect(
      classifyInvitation({
        signedIn: true,
        error: { status: 400, message: "Invitation not found!" },
        now: NOW,
      }),
    ).toBe("unavailable");
  });

  test("a session that expired while viewing counts as signed out", () => {
    expect(classifyInvitation({ signedIn: true, error: { status: 401 }, now: NOW })).toBe(
      "signed-out",
    );
  });
});

describe("pendingInvitations", () => {
  test("keeps only pending invitations that have not expired", () => {
    const invitations = [
      { id: "a", status: "pending", expiresAt: LATER },
      { id: "b", status: "pending", expiresAt: EARLIER },
      { id: "c", status: "accepted", expiresAt: LATER },
    ];
    expect(pendingInvitations(invitations, NOW).map((i) => i.id)).toEqual(["a"]);
  });
});
