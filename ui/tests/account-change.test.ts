import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { refreshAfterAccountChange } from "../src/lib/account";
import { type AuthClient, sessionQueryKey } from "../src/lib/auth";

function authClientReturning(session: unknown) {
  const calls: unknown[] = [];
  const authClient = {
    getSession: async (options?: unknown) => {
      calls.push(options);
      return { data: session, error: null };
    },
  } as unknown as AuthClient;
  return { authClient, calls };
}

describe("refreshAfterAccountChange", () => {
  test("drops everything cached for the previous user", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["me", "roles"], { orgRole: "owner" });
    queryClient.setQueryData(["organizations", "list"], [{ id: "old" }]);
    const { authClient } = authClientReturning(null);

    await refreshAfterAccountChange(queryClient, authClient);

    expect(queryClient.getQueryData(["me", "roles"])).toBeUndefined();
    expect(queryClient.getQueryData(["organizations", "list"])).toBeUndefined();
  });

  test("reads the new session past the cookie cache", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQueryKey, { user: { id: "previous" } });
    const { authClient, calls } = authClientReturning({ user: { id: "next" } });

    const session = await refreshAfterAccountChange(queryClient, authClient);

    expect(session).toEqual({ user: { id: "next" } });
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual({ user: { id: "next" } });
    expect(calls).toEqual([{ query: { disableCookieCache: true } }]);
  });
});
