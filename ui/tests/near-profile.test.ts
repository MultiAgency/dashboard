import { QueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";
import { siwnClient } from "better-near-auth/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { nearProfileQueryOptions } from "../src/lib/near-profile";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const requests: string[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { accountId } = JSON.parse(String(init?.body));
    if (!accountId) throw new Error("Profile request must include an account ID");
    requests.push(accountId);
    return Response.json({ name: accountId });
  });
  vi.stubGlobal("fetch", fetch);
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [siwnClient({ recipient: "multiagency.sputnik-dao.near" })],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return { authClient, queryClient, requests, fetch };
}

describe("NEAR profile requests", () => {
  test("sends the selected account through the real auth client and isolates cached profiles", async () => {
    const { authClient, queryClient, requests } = setup();
    for (const accountId of ["alice.near", "bob.near", "alice.near"]) {
      await expect(
        queryClient.fetchQuery(nearProfileQueryOptions(authClient, accountId)),
      ).resolves.toEqual({ name: accountId });
    }
    expect(requests).toEqual(["alice.near", "bob.near"]);
    queryClient.clear();
  });

  test.each([
    null,
    undefined,
    "",
  ])("never requests a profile without an account (%s)", async (accountId) => {
    const { authClient, queryClient, fetch } = setup();
    const options = nearProfileQueryOptions(authClient, accountId);
    expect(options.enabled).toBe(false);
    await expect(queryClient.fetchQuery(options)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    queryClient.clear();
  });
});
