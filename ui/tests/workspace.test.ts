import { describe, expect, test, vi } from "vitest";
import type { AuthClient } from "../src/lib/auth";
import { switchAgencyWorkspace } from "../src/lib/workspace";

function setup() {
  const session = (activeOrganizationId: string) => ({
    data: { session: { activeOrganizationId }, user: { id: "user" } },
    error: null,
  });
  const getSession = vi.fn().mockResolvedValue(session("agency-a"));
  const setActive = vi.fn().mockResolvedValue({ data: { id: "agency-b" }, error: null });
  const client = {
    getSession,
    organization: {
      list: vi.fn().mockResolvedValue({
        data: ["agency-a", "agency-b"].map((id) => ({ id, metadata: { type: "agency" } })),
      }),
      setActive,
    },
  } as unknown as AuthClient;
  return { client, getSession, setActive, session };
}

describe("agency workspace switching", () => {
  test("validates the stored session before switching and verifies the resulting organization", async () => {
    const { client, getSession, setActive, session } = setup();
    getSession
      .mockResolvedValueOnce(session("agency-a"))
      .mockResolvedValueOnce(session("agency-b"));
    await expect(switchAgencyWorkspace(client, "agency-b")).resolves.toBe(true);
    expect(setActive).toHaveBeenCalledExactlyOnceWith({ organizationId: "agency-b" });
    expect(getSession).toHaveBeenCalledTimes(2);
    for (const [options] of getSession.mock.calls) {
      expect(options).toEqual({ query: { disableCookieCache: true } });
    }
  });

  test("does not mutate a session that no longer exists", async () => {
    const { client, getSession, setActive } = setup();
    getSession.mockResolvedValue({ data: null, error: null });
    await expect(switchAgencyWorkspace(client, "agency-b")).rejects.toThrow("session has expired");
    expect(setActive).not.toHaveBeenCalled();
  });

  test("does not mutate when session validation fails", async () => {
    const { client, getSession, setActive } = setup();
    getSession.mockResolvedValue({ data: null, error: { message: "Session lookup failed" } });
    await expect(switchAgencyWorkspace(client, "agency-b")).rejects.toThrow(
      "Session lookup failed",
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  test("does not retry a mutation when the stored organization did not change", async () => {
    const { client, setActive } = setup();
    await expect(switchAgencyWorkspace(client, "agency-b")).resolves.toBe(false);
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  test("does not mutate after a failed update", async () => {
    const { client, setActive } = setup();
    setActive.mockResolvedValue({ error: { status: 500 } });
    await expect(switchAgencyWorkspace(client, "agency-b")).resolves.toBe(false);
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  test("does not switch when the selected agency is already active", async () => {
    const { client, setActive } = setup();
    await expect(switchAgencyWorkspace(client, "agency-a")).resolves.toBe(true);
    expect(setActive).not.toHaveBeenCalled();
  });
});
