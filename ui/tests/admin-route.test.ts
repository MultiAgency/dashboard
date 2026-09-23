import { describe, expect, test, vi } from "vitest";
import { Route } from "../src/routes/_layout/_authenticated/admin/route";

function loadAdminRoute(
  orgRole: "owner" | "admin" | "member" | null,
  pathname = "/admin/projects",
) {
  const roles = { orgRole, hasAgencyDao: false };
  const apiClient = { me: { roles: vi.fn().mockResolvedValue(roles) } };
  const queryClient = {
    ensureQueryData: vi.fn((options: { queryFn: () => Promise<typeof roles> }) =>
      options.queryFn(),
    ),
  };
  const result = Route.options.beforeLoad!({
    context: { apiClient, queryClient },
    location: { pathname },
  } as never);
  return { result, apiClient };
}

describe("Agency dashboard access", () => {
  test.each(["owner", "admin"] as const)("allows an Organization %s", async (orgRole) => {
    const { result, apiClient } = loadAdminRoute(orgRole);
    await expect(result).resolves.toMatchObject({ roles: { orgRole } });
    expect(apiClient.me.roles).toHaveBeenCalledOnce();
  });

  test("directs an account without an active Agency Organization to creation", async () => {
    const { result } = loadAdminRoute(null);
    await expect(result).rejects.toMatchObject({
      options: { to: "/", hash: "organization-required" },
    });
  });

  test("allows a member to work on Organization Projects", async () => {
    const { result } = loadAdminRoute("member");
    await expect(result).resolves.toMatchObject({ roles: { orgRole: "member" } });
  });

  test("denies a member access to Organization administration", async () => {
    const { result } = loadAdminRoute("member", "/admin/engagements");
    await expect(result).rejects.toMatchObject({ options: { to: "/", hash: "unauthorized" } });
  });
});
