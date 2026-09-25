import { describe, expect, test } from "vitest";
import { classifyInvitation, pendingInvitations } from "../src/lib/invitations";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const LATER = "2026-10-01T00:00:00.000Z";
const EARLIER = "2026-09-20T00:00:00.000Z";

describe("classifyInvitation", () => {
  test.each([
    ["signed-out visitors", { signedIn: false }, "signed-out"],
    [
      "a session that expired while viewing",
      { signedIn: true, error: { status: 401 } },
      "signed-out",
    ],
    ["an invitation the server returns", { signedIn: true, invitation: { id: "i1" } }, "pending"],
    [
      "an invitation for another email",
      {
        signedIn: true,
        error: { status: 403, code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" },
      },
      "wrong-email",
    ],
    [
      "an unverified email",
      {
        signedIn: true,
        error: { status: 403, code: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION" },
      },
      "verify-email",
    ],
    [
      "an expired, declined, canceled or used invitation",
      { signedIn: true, error: { status: 400, message: "Invitation not found!" } },
      "unavailable",
    ],
  ] as const)("%s", (_, input, state) => {
    expect(classifyInvitation(input)).toBe(state);
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
