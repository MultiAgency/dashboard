import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./api";
import { getNetwork } from "./auth";

// Loader-hit queries include the active network in their queryKey so SSR data
// cached under one network can't be served to a hydrating client requesting a
// different network. Server-side `getNetwork()` falls through to the runtime
// config default (no URL/localStorage on server); client-side reads URL →
// localStorage. Mismatch triggers refetch with X-Network header on hydration.
//
// Exported `*QueryKey` consts are invalidation prefixes — TanStack Query's
// `invalidateQueries({ queryKey: [...] })` is prefix-match, so passing the
// network-less prefix invalidates every network's cached entry at once
// (which is what callers usually want).

export const publicSettingsQueryKey = ["settings", "public"] as const;

export function publicSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...publicSettingsQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });
}

export const adminSettingsQueryKey = ["settings", "admin"] as const;

export function adminSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...adminSettingsQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.settings.adminGet(),
    staleTime: 30_000,
    retry: false,
  });
}

export const meRolesQueryKey = ["me", "roles"] as const;

export function meRolesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...meRolesQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.me.roles(),
    staleTime: 60_000,
    retry: false,
  });
}

export const teamListQueryKey = ["team", "list"] as const;

export function teamListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...teamListQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.team.list(),
    staleTime: 60_000,
    retry: false,
  });
}

export const projectsListQueryKey = ["projects", "list"] as const;

export function projectsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...projectsListQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.agency.projects.list(),
    staleTime: 60_000,
  });
}

export const tokensListQueryKey = ["tokens", "list"] as const;

export function tokensListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...tokensListQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.tokens.list(),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function treasuryPublicBalancesQueryOptions(apiClient: ApiClient, tokenIds: string[]) {
  return queryOptions({
    queryKey: [
      "treasury",
      "balances",
      "public",
      getNetwork(),
      [...tokenIds].sort().join(","),
    ] as const,
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
