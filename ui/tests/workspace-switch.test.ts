import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type SessionData, sessionQueryKey } from "../src/lib/auth";
import { setActiveOrganizationKey, showWorkspace, workspaceKey } from "../src/lib/queries";
import { announceWorkspace, onWorkspaceChange } from "../src/lib/workspace";

const router = { invalidate: async () => {} };

function session(activeOrganizationId: string): SessionData {
  return { user: { id: "u1" }, session: { activeOrganizationId } } as unknown as SessionData;
}

afterEach(() => setActiveOrganizationKey(null));

describe("switching Organization", () => {
  test("never caches one Organization's data under another's key", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let serverOrganization = "agency";
    setActiveOrganizationKey("agency");
    queryClient.setQueryData(sessionQueryKey, session("agency"));
    const observer = new QueryObserver(queryClient, {
      queryKey: ["admin", "projects", ...workspaceKey()],
      queryFn: async () => `projects of ${serverOrganization}`,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe("projects of agency"));

    serverOrganization = "client";
    await showWorkspace(queryClient, router, session("client"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["admin", "projects"] })) {
      const owner = query.queryKey.includes("agency") ? "agency" : "client";
      expect(query.state.data ?? `projects of ${owner}`).toBe(`projects of ${owner}`);
    }
    expect(workspaceKey()).toContain("client");
    expect(
      queryClient.getQueryData<SessionData>(sessionQueryKey)?.session.activeOrganizationId,
    ).toBe("client");
    unsubscribe();
  });
});

describe("other tabs", () => {
  test("hear about a switch made in another tab", async () => {
    const heard = vi.fn();
    const stop = onWorkspaceChange(heard);
    announceWorkspace("client");
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    stop();
  });

  test("re-check when they become visible again", () => {
    const heard = vi.fn();
    const stop = onWorkspaceChange(heard);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
