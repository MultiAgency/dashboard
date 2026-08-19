import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import type { ApiClient } from "./api";
import { sessionQueryKey } from "./auth";
import { getNetwork } from "./network";

// Loader-hit queries include the active network in their queryKey so data
// cached under one network can't be served when the visitor switches to
// another. `getNetwork()` reads URL → current_near_network cookie (client-only);
// the cookie rides the api client's credentials:include so the server resolves
// the same network for the fetch.
//
// Exported `*QueryKey` consts are invalidation prefixes — TanStack Query's
// `invalidateQueries({ queryKey: [...] })` is prefix-match, so passing the
// network-less prefix invalidates every network's cached entry at once
// (which is what callers usually want).

export const publicSettingsQueryKey = ["settings", "public"] as const;

export function publicSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...publicSettingsQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.agencyConfig.getPublic(),
    staleTime: 5 * 60_000,
  });
}

export const adminSettingsQueryKey = ["settings", "admin"] as const;

export function adminSettingsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...adminSettingsQueryKey, getNetwork()] as const,
    queryFn: () => apiClient.agencyConfig.get(),
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
    queryFn: () => apiClient.agency.projects.list(),
    retry: false,
  });
}

export const adminContributorsListQueryKey = ["admin", "contributors", "list"] as const;

export function adminContributorsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminContributorsListQueryKey,
    queryFn: () => apiClient.contributors.list(),
    retry: false,
  });
}

export const adminAssignmentsListQueryKey = ["admin", "assignments", "list"] as const;

export function adminAssignmentsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminAssignmentsListQueryKey,
    queryFn: () => apiClient.assignments.listAll(),
    staleTime: 60_000,
    retry: false,
  });
}

export const adminBillingsListQueryKey = ["admin", "billings", "list"] as const;

export function adminApplicationsListQueryKey(kind?: string | null, status?: string | null) {
  return ["admin", "applications", "list", kind ?? null, status ?? null] as const;
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

export function adminProjectDetailQueryOptions(apiClient: ApiClient, slug: string) {
  return queryOptions({
    queryKey: [...adminProjectDetailQueryKey, getNetwork(), slug] as const,
    queryFn: () => apiClient.agency.projects.get({ slug }),
    retry: false,
  });
}

export const adminProjectBudgetQueryKey = ["admin", "projects", "budget"] as const;

export function adminProjectBudgetQueryOptions(apiClient: ApiClient, projectId: string) {
  return queryOptions({
    queryKey: [...adminProjectBudgetQueryKey, getNetwork(), projectId] as const,
    queryFn: () => apiClient.agency.projects.getBudget({ projectId }),
    staleTime: 30_000,
  });
}

export const adminInternalListingQueryKey = ["admin", "listings", "internal"] as const;

export function adminInternalListingQueryOptions(apiClient: ApiClient, projectId: string) {
  return queryOptions({
    queryKey: [...adminInternalListingQueryKey, getNetwork(), projectId] as const,
    queryFn: () => apiClient.agency.listings.get({ projectId }),
    retry: false,
  });
}

export const adminNearnSubmissionsQueryKey = ["admin", "nearn", "submissions"] as const;

export function adminNearnSubmissionsQueryOptions(apiClient: ApiClient, slug: string) {
  return queryOptions({
    queryKey: [...adminNearnSubmissionsQueryKey, getNetwork(), slug] as const,
    queryFn: () => apiClient.nearn.listSubmissions({ slug }),
    staleTime: 60_000,
    retry: false,
  });
}

export const adminClientsListQueryKey = ["admin", "clients", "list"] as const;

export function adminClientsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: adminClientsListQueryKey,
    queryFn: () => apiClient.clients.list(),
    retry: false,
  });
}

export function adminClientDetailQueryOptions(apiClient: ApiClient, id: string) {
  return queryOptions({
    queryKey: ["admin", "clients", "detail", id] as const,
    queryFn: () => apiClient.clients.get({ id }),
    retry: false,
  });
}

export function adminContributorDetailQueryOptions(apiClient: ApiClient, nearAccount: string) {
  return queryOptions({
    queryKey: ["admin", "contributors", "detail", nearAccount] as const,
    queryFn: () => apiClient.contributors.get({ nearAccount }),
    retry: false,
  });
}

export function clientLookupQueryOptions(apiClient: ApiClient, nearAccountId: string) {
  return queryOptions({
    queryKey: ["client", "lookup", nearAccountId] as const,
    queryFn: () => apiClient.clients.lookupByNearAccount({ nearAccountId }),
    retry: false,
  });
}

export function clientPortalDashboardSummaryQueryOptions(
  apiClient: ApiClient,
  agencyDaoAccountId: string,
) {
  return queryOptions({
    queryKey: ["client", "portal", "dashboard", getNetwork(), agencyDaoAccountId] as const,
    queryFn: () => apiClient.clientPortal.dashboard.summary({ agencyDaoAccountId }),
    retry: false,
  });
}

export const clientPortalProjectsListQueryKey = ["client", "portal", "projects"] as const;

export function clientPortalProjectsListQueryOptions(
  apiClient: ApiClient,
  agencyDaoAccountId: string,
) {
  return queryOptions({
    queryKey: [...clientPortalProjectsListQueryKey, getNetwork(), agencyDaoAccountId] as const,
    queryFn: () => apiClient.clientPortal.projects.list({ agencyDaoAccountId }),
    retry: false,
  });
}

export const clientPortalProjectDetailQueryKey = [
  "client",
  "portal",
  "projects",
  "detail",
] as const;

export function clientPortalProjectDetailQueryOptions(
  apiClient: ApiClient,
  agencyDaoAccountId: string,
  slug: string,
) {
  return queryOptions({
    queryKey: [
      ...clientPortalProjectDetailQueryKey,
      getNetwork(),
      agencyDaoAccountId,
      slug,
    ] as const,
    queryFn: () => apiClient.clientPortal.projects.get({ slug, agencyDaoAccountId }),
    retry: false,
  });
}

export const clientPortalProjectBudgetQueryKey = [
  "client",
  "portal",
  "projects",
  "budget",
] as const;

export function clientPortalProjectBudgetQueryOptions(
  apiClient: ApiClient,
  agencyDaoAccountId: string,
  projectId: string,
) {
  return queryOptions({
    queryKey: [
      ...clientPortalProjectBudgetQueryKey,
      getNetwork(),
      agencyDaoAccountId,
      projectId,
    ] as const,
    queryFn: () => apiClient.clientPortal.projects.getBudget({ projectId, agencyDaoAccountId }),
    staleTime: 30_000,
    retry: false,
  });
}

export async function invalidateWorkspaceQueries(
  queryClient: QueryClient,
  router: Pick<AnyRouter, "invalidate">,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["organizations"] }),
    queryClient.invalidateQueries({ queryKey: ["members"] }),
    queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
    queryClient.invalidateQueries({ queryKey: projectsListQueryKey }),
    queryClient.invalidateQueries({ queryKey: teamListQueryKey }),
    queryClient.invalidateQueries({ queryKey: publicSettingsQueryKey }),
    queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["treasury"] }),
    queryClient.invalidateQueries({ queryKey: ["proposals"] }),
    queryClient.invalidateQueries({ queryKey: ["admin"] }),
    queryClient.invalidateQueries({ queryKey: ["client"] }),
    queryClient.invalidateQueries({ queryKey: ["me"] }),
    queryClient.invalidateQueries({ queryKey: tokensListQueryKey }),
    router.invalidate(),
  ]);
}
