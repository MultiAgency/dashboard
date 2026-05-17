import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./api";

export const publicSettingsQueryKey = ["settings", "public"] as const;

export function publicSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: publicSettingsQueryKey,
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
}

export const adminSettingsQueryKey = ["settings", "adminGet"] as const;

export function adminSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminSettingsQueryKey,
    queryFn: () => apiClient.settings.adminGet(),
    retry: false,
  });
}

export const meRolesQueryKey = ["me", "roles"] as const;

export function meRolesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: meRolesQueryKey,
    queryFn: () => apiClient.me.roles(),
    staleTime: 60_000,
    retry: false,
  });
}

export const teamListQueryKey = ["team", "list"] as const;

export function teamListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: teamListQueryKey,
    queryFn: () => apiClient.team.list(),
    staleTime: 60_000,
    retry: false,
  });
}

export const projectsListQueryKey = ["projects", "list"] as const;

export function projectsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: projectsListQueryKey,
    queryFn: () => apiClient.agency.projects.list(),
    staleTime: 60_000,
  });
}

export const tokensListQueryKey = ["tokens", "list"] as const;

export function tokensListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: tokensListQueryKey,
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function treasuryPublicBalancesQueryOptions(apiClient: ApiClient, tokenIds: string[]) {
  return queryOptions({
    queryKey: ["treasury", "balances", "public", [...tokenIds].sort().join(",")] as const,
    queryFn: () => apiClient.treasury.getPublicBalances({ tokenIds }),
    enabled: tokenIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

export const adminProjectsListQueryKey = ["admin", "projects", "list"] as const;

export function adminProjectsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminProjectsListQueryKey,
    queryFn: () => apiClient.agency.projects.adminList(),
    retry: false,
  });
}

export const adminContributorsListQueryKey = ["admin", "contributors", "list"] as const;

export function adminContributorsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminContributorsListQueryKey,
    queryFn: () => apiClient.contributors.adminList(),
    retry: false,
  });
}

export const adminTokensQueryKey = ["admin", "tokens"] as const;

export function adminTokensQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminTokensQueryKey,
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
  });
}
