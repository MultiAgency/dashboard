import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { refreshAfterAccountChange, signInDestination } from "../src/lib/account";
import type { ApiClient } from "../src/lib/api";
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

describe("signInDestination", () => {
  function signedInWithoutActiveOrganization() {
    const activated: string[] = [];
    const authClient = {
      getSession: async () => ({ data: { session: { activeOrganizationId: null } }, error: null }),
      organization: {
        list: async () => ({ data: [{ id: "studio", metadata: null }] }),
        setActive: async ({ organizationId }: { organizationId: string }) => {
          activated.push(organizationId);
          return { error: null };
        },
      },
    } as unknown as AuthClient;
    const apiClient = {
      me: { roles: async () => ({ capabilities: { hasAgencySections: true } }) },
    } as unknown as ApiClient;
    return { authClient, apiClient, activated, queryClient: new QueryClient() };
  }

  test("activates the Organization before following a redirect", async () => {
    const { activated, ...deps } = signedInWithoutActiveOrganization();

    expect(await signInDestination(deps, "/admin/projects?tab=billing")).toBe(
      "/admin/projects?tab=billing",
    );
    expect(activated).toEqual(["studio"]);
  });

  test("still follows the redirect when opening the Organization fails", async () => {
    const { activated: _, ...deps } = signedInWithoutActiveOrganization();
    const failing = {
      ...deps,
      authClient: {
        ...deps.authClient,
        organization: {
          ...deps.authClient.organization,
          setActive: async () => ({ error: { message: "Could not open" } }),
        },
      } as unknown as AuthClient,
    };

    expect(await signInDestination(failing, "/accept-invitation/abc")).toBe(
      "/accept-invitation/abc",
    );
    await expect(signInDestination(failing, undefined)).rejects.toThrow("Could not open");
  });

  test("lands on the Organization home without a redirect", async () => {
    const { activated, ...deps } = signedInWithoutActiveOrganization();

    expect(await signInDestination(deps, undefined)).toBe("/admin");
    expect(activated).toEqual(["studio"]);
  });
});
