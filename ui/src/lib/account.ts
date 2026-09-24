import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./api";
import { type AuthClient, sessionQueryKey, sessionQueryOptions } from "./auth";
import { pendingInvitations } from "./invitations";
import { type OrganizationHome, organizationHome, organizationToActivate } from "./landing";
import { meRolesQueryKey, meRolesQueryOptions } from "./queries";

export const WELCOME_PATH = "/welcome";

export const userInvitationsQueryKey = ["me", "invitations"] as const;

export type UserInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date | string;
};

export function userInvitationsQueryOptions(authClient: AuthClient, enabled: boolean) {
  return queryOptions({
    queryKey: userInvitationsQueryKey,
    queryFn: async (): Promise<UserInvitation[]> => {
      const { data, error } = await authClient.organization.listUserInvitations();
      if (error || !Array.isArray(data)) return [];
      return pendingInvitations(data as UserInvitation[], new Date());
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export const organizationsQueryKey = ["organizations", "list"] as const;

export function organizationsQueryOptions(authClient: AuthClient) {
  return queryOptions({
    queryKey: organizationsQueryKey,
    queryFn: async () => {
      const res = await authClient.organization.list();
      return res.data ?? [];
    },
  });
}

export async function refreshAccountQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
    queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["organizations"] }),
    queryClient.invalidateQueries({ queryKey: ["members"] }),
    queryClient.invalidateQueries({ queryKey: userInvitationsQueryKey }),
  ]);
}

export async function landingDestination(deps: {
  authClient: AuthClient;
  apiClient: ApiClient;
  queryClient: QueryClient;
}): Promise<OrganizationHome | typeof WELCOME_PATH> {
  const { authClient, apiClient, queryClient } = deps;
  const [session, organizations] = await Promise.all([
    queryClient.fetchQuery({ ...sessionQueryOptions(authClient), staleTime: 0 }),
    queryClient.fetchQuery({ ...organizationsQueryOptions(authClient), staleTime: 0 }),
  ]);
  const activeId = session?.session?.activeOrganizationId ?? null;
  const target = organizationToActivate(activeId, organizations);
  if (!target) return WELCOME_PATH;
  if (target !== activeId) {
    const { error } = await authClient.organization.setActive({ organizationId: target });
    if (error) throw new Error(error.message ?? "Could not open your Organization");
    await refreshAccountQueries(queryClient);
  }
  const roles = await queryClient.fetchQuery({ ...meRolesQueryOptions(apiClient), staleTime: 0 });
  return organizationHome(roles.capabilities);
}
