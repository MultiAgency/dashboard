import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./api";

export const publicSettingsQueryKey = ["settings", "public"] as const;

export function publicSettingsQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...publicSettingsQueryKey, network] as const,
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
}

export const adminSettingsQueryKey = ["settings", "admin"] as const;

export function adminSettingsQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...adminSettingsQueryKey, network] as const,
    queryFn: () => apiClient.settings.adminGet(),
    staleTime: 30_000,
    retry: false,
  });
}

export const meRolesQueryKey = ["me", "roles"] as const;

export function meRolesQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...meRolesQueryKey, network] as const,
    queryFn: () => apiClient.me.roles(),
    staleTime: 60_000,
    retry: false,
  });
}

export const teamListQueryKey = ["team", "list"] as const;

export function teamListQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...teamListQueryKey, network] as const,
    queryFn: () => apiClient.team.list(),
    staleTime: 60_000,
    retry: false,
  });
}

export const projectsListQueryKey = ["projects", "list"] as const;

export function projectsListQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...projectsListQueryKey, network] as const,
    queryFn: () => apiClient.agency.projects.list(),
    staleTime: 60_000,
  });
}

export const tokensListQueryKey = ["tokens", "list"] as const;

export function tokensListQueryOptions(apiClient: ApiClient, network?: string) {
  return queryOptions({
    queryKey: [...tokensListQueryKey, network] as const,
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function treasuryPublicBalancesQueryOptions(
  apiClient: ApiClient,
  tokenIds: string[],
  network?: string,
) {
  return queryOptions({
    queryKey: ["treasury", "balances", "public", network, [...tokenIds].sort().join(",")] as const,
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

export const adminProjectDetailQueryKey = ["admin", "projects", "detail"] as const;

export function adminProjectDetailQueryOptions(
  apiClient: ApiClient,
  slug: string,
  network?: string,
) {
  return queryOptions({
    queryKey: [...adminProjectDetailQueryKey, network, slug] as const,
    queryFn: () => apiClient.agency.projects.adminGet({ slug }),
    retry: false,
  });
}

export const adminProjectBudgetQueryKey = ["admin", "projects", "budget"] as const;

export function adminProjectBudgetQueryOptions(
  apiClient: ApiClient,
  projectId: string,
  network?: string,
) {
  return queryOptions({
    queryKey: [...adminProjectBudgetQueryKey, network, projectId] as const,
    queryFn: () => apiClient.agency.projects.getBudget({ projectId }),
    staleTime: 30_000,
  });
}

export const adminInternalListingQueryKey = ["admin", "listings", "internal"] as const;

export function adminInternalListingQueryOptions(
  apiClient: ApiClient,
  projectId: string,
  network?: string,
) {
  return queryOptions({
    queryKey: [...adminInternalListingQueryKey, network, projectId] as const,
    queryFn: () => apiClient.agency.listings.adminGet({ projectId }),
    retry: false,
  });
}

export const adminNearnSubmissionsQueryKey = ["admin", "nearn", "submissions"] as const;

export function adminNearnSubmissionsQueryOptions(
  apiClient: ApiClient,
  slug: string,
  network?: string,
) {
  return queryOptions({
    queryKey: [...adminNearnSubmissionsQueryKey, network, slug] as const,
    queryFn: () => apiClient.nearn.listSubmissions({ slug }),
    staleTime: 60_000,
    retry: false,
  });
}
