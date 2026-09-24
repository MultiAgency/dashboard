import type { QueryClient, QueryKey } from "@tanstack/react-query";
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

let activeOrganizationId: string | null = null;

export function setActiveOrganizationKey(organizationId: string | null | undefined) {
  activeOrganizationId = organizationId ?? null;
}

export function workspaceKey() {
  return [getNetwork(), typeof window === "undefined" ? null : activeOrganizationId] as const;
}

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
    queryKey: [...adminSettingsQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.agencyConfig.get(),
    staleTime: 30_000,
    retry: false,
  });
}

export const agencyDaoQueryKey = ["admin", "agency-dao"] as const;

export function agencyDaoQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...agencyDaoQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.agencyDao.get(),
    retry: false,
  });
}

export const meRolesQueryKey = ["me", "roles"] as const;

export function meRolesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...meRolesQueryKey, ...workspaceKey()] as const,
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

export function tokenStorageStatusQueryOptions(apiClient: ApiClient, tokenId: string | null) {
  return queryOptions({
    queryKey: ["tokens", "storage-status", getNetwork(), tokenId ?? ""] as const,
    queryFn: () => apiClient.tokens.getStorageStatus({ tokenId: tokenId ?? "" }),
    enabled: !!tokenId,
    staleTime: 60_000,
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
    queryKey: [...adminProjectsListQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.agency.projects.listOwned(),
    retry: false,
  });
}

export const adminContributorsListQueryKey = ["admin", "contributors", "list"] as const;

export function adminContributorsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...adminContributorsListQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.contributors.list(),
    retry: false,
  });
}

export const adminAssignmentsListQueryKey = ["admin", "assignments", "list"] as const;

export function adminAssignmentsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...adminAssignmentsListQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.assignments.listAll(),
    staleTime: 60_000,
    retry: false,
  });
}

export const adminBillingsListQueryKey = ["admin", "billings", "list"] as const;

export const clientBillingsListQueryKey = ["client", "billings", "list"] as const;

type BillingFilters = {
  projectId?: string | null;
  nearAccount?: string | null;
};

export function adminBillingsQueryKey(filters: BillingFilters) {
  return [
    ...adminBillingsListQueryKey,
    ...workspaceKey(),
    filters.projectId ?? null,
    filters.nearAccount ?? null,
  ] as const;
}

export function clientBillingsQueryKey(engagementId: string, projectId: string | null) {
  return [...clientBillingsListQueryKey, ...workspaceKey(), engagementId, projectId] as const;
}

export function adminContributorBillingsQueryKey(nearAccount: string) {
  return ["admin", "billings", "contributor", ...workspaceKey(), nearAccount] as const;
}

export function adminBudgetsLogQueryKey(filters: {
  projectId: string | null;
  tokenId: string | null;
  engagementId: string | null;
}) {
  return [
    "admin",
    "budgets",
    "log",
    ...workspaceKey(),
    filters.projectId,
    filters.tokenId,
    filters.engagementId,
  ] as const;
}

export function adminProjectBudgetsLogQueryKey(projectId: string) {
  return ["admin", "budgets", "project", ...workspaceKey(), projectId] as const;
}

export function adminProjectsForTokenQueryKey(tokenId: string) {
  return ["admin", "budgets", "projects-for-token", ...workspaceKey(), tokenId] as const;
}

export function adminAssignmentsForProjectQueryKey(projectId: string) {
  return ["admin", "assignments", "project", ...workspaceKey(), projectId] as const;
}

export const proposalsListQueryKey = ["proposals", "list"] as const;

export function proposalsQueryKey() {
  return [...proposalsListQueryKey, getNetwork()] as const;
}

export function adminApplicationsListQueryKey(kind?: string | null, status?: string | null) {
  return ["admin", "applications", "list", kind ?? null, status ?? null] as const;
}

export const adminTokensQueryKey = ["admin", "tokens"] as const;

export function adminTokensQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...adminTokensQueryKey, ...workspaceKey()] as const,
    queryFn: () => apiClient.tokens.listOwned(),
    staleTime: 60 * 60_000,
  });
}

export const adminProjectDetailQueryKey = ["admin", "projects", "detail"] as const;

export function adminProjectDetailQueryOptions(apiClient: ApiClient, slug: string) {
  return queryOptions({
    queryKey: [...adminProjectDetailQueryKey, ...workspaceKey(), slug] as const,
    queryFn: () => apiClient.agency.projects.get({ slug }),
    retry: false,
  });
}

export const adminProjectBudgetQueryKey = ["admin", "projects", "budget"] as const;

export function adminProjectBudgetQueryOptions(apiClient: ApiClient, projectId: string) {
  return queryOptions({
    queryKey: [...adminProjectBudgetQueryKey, ...workspaceKey(), projectId] as const,
    queryFn: () => apiClient.agency.projects.getBudget({ projectId }),
    staleTime: 30_000,
    retry: false,
  });
}

export const adminInternalListingQueryKey = ["admin", "listings", "internal"] as const;

export function adminInternalListingQueryOptions(apiClient: ApiClient, projectId: string) {
  return queryOptions({
    queryKey: [...adminInternalListingQueryKey, ...workspaceKey(), projectId] as const,
    queryFn: () => apiClient.agency.listings.get({ projectId }),
    retry: false,
  });
}

export const adminNearnSubmissionsQueryKey = ["admin", "nearn", "submissions"] as const;

export function adminNearnSubmissionsQueryOptions(apiClient: ApiClient, slug: string) {
  return queryOptions({
    queryKey: [...adminNearnSubmissionsQueryKey, ...workspaceKey(), slug] as const,
    queryFn: () => apiClient.nearn.listSubmissions({ slug }),
    staleTime: 60_000,
    retry: false,
  });
}

export const adminNearnListingQueryKey = ["admin", "nearn", "listing"] as const;

export function adminNearnListingQueryOptions(apiClient: ApiClient, slug: string) {
  return queryOptions({
    queryKey: [...adminNearnListingQueryKey, ...workspaceKey(), slug] as const,
    queryFn: () => apiClient.nearn.getListing({ slug }),
    enabled: slug.length > 1,
    staleTime: 60_000,
    retry: false,
  });
}

export function adminNearnSponsorBountiesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: ["admin", "nearn", "sponsor-bounties", ...workspaceKey()] as const,
    queryFn: () => apiClient.nearn.listSponsorBounties(),
    staleTime: 60_000,
    retry: false,
  });
}

export function adminContributorDetailQueryOptions(apiClient: ApiClient, nearAccount: string) {
  return queryOptions({
    queryKey: ["admin", "contributors", "detail", ...workspaceKey(), nearAccount] as const,
    queryFn: () => apiClient.contributors.get({ nearAccount }),
    retry: false,
  });
}

export const engagementsQueryKey = ["admin", "engagements"] as const;

export function engagementsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...engagementsQueryKey, "list", ...workspaceKey()] as const,
    queryFn: () => apiClient.engagements.list(),
    retry: false,
  });
}

export function engagementDetailQueryOptions(apiClient: ApiClient, id: string) {
  return queryOptions({
    queryKey: [...engagementsQueryKey, "detail", ...workspaceKey(), id] as const,
    queryFn: () => apiClient.engagements.get({ id }),
    retry: false,
  });
}

export const clientPortalQueryKey = ["client", "portal"] as const;

export function clientPortalDashboardSummaryQueryOptions(
  apiClient: ApiClient,
  engagementId: string,
) {
  return queryOptions({
    queryKey: [...clientPortalQueryKey, "dashboard", ...workspaceKey(), engagementId] as const,
    queryFn: () => apiClient.clientPortal.dashboard.summary({ engagementId }),
    retry: false,
  });
}

export function clientPortalProjectsListQueryOptions(apiClient: ApiClient, engagementId: string) {
  return queryOptions({
    queryKey: [...clientPortalQueryKey, "projects", ...workspaceKey(), engagementId] as const,
    queryFn: () => apiClient.clientPortal.projects.list({ engagementId }),
    retry: false,
  });
}

export function clientPortalProjectDetailQueryOptions(
  apiClient: ApiClient,
  engagementId: string,
  slug: string,
) {
  return queryOptions({
    queryKey: [...clientPortalQueryKey, "project", ...workspaceKey(), engagementId, slug] as const,
    queryFn: () => apiClient.clientPortal.projects.get({ slug, engagementId }),
    retry: false,
  });
}

export function clientPortalProjectBudgetQueryOptions(
  apiClient: ApiClient,
  engagementId: string,
  projectId: string,
) {
  return queryOptions({
    queryKey: [
      ...clientPortalQueryKey,
      "budget",
      ...workspaceKey(),
      engagementId,
      projectId,
    ] as const,
    queryFn: () => apiClient.clientPortal.projects.getBudget({ projectId, engagementId }),
    staleTime: 30_000,
    retry: false,
  });
}

export const myOrganizationsQueryKey = ["me", "organizations"] as const;

export function myOrganizationsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: myOrganizationsQueryKey,
    queryFn: () => apiClient.me.organizations(),
    staleTime: 60_000,
    retry: false,
  });
}

export function myAssignedProjectsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: ["me", "assigned-projects", getNetwork()] as const,
    queryFn: () => apiClient.me.assignedProjects(),
    retry: false,
  });
}

export const notificationsQueryKey = ["notifications"] as const;

export function unreadNotificationsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: [...notificationsQueryKey, "unread"] as const,
    queryFn: () => apiClient.notifications.unreadCount(),
    refetchInterval: 60_000,
    retry: false,
  });
}

export type DataChange =
  | { type: "budgetEntries"; projectIds: string[] }
  | { type: "billings" }
  | { type: "listing"; projectId: string }
  | { type: "projects" }
  | { type: "projectDeleted" }
  | { type: "assignments" }
  | { type: "applications" }
  | { type: "builders" }
  | { type: "engagements" }
  | { type: "notifications" }
  | { type: "settings" };

function staleKeys(change: DataChange): QueryKey[] {
  switch (change.type) {
    case "budgetEntries":
      return [
        ["admin", "budgets"],
        ...change.projectIds.map((projectId) => [
          ...adminProjectBudgetQueryKey,
          ...workspaceKey(),
          projectId,
        ]),
        clientPortalQueryKey,
      ];
    case "billings":
      return [
        ["admin", "billings"],
        adminProjectBudgetQueryKey,
        proposalsListQueryKey,
        ["client", "billings"],
        clientPortalQueryKey,
      ];
    case "listing":
      return [
        [...adminInternalListingQueryKey, ...workspaceKey(), change.projectId],
        [...adminProjectBudgetQueryKey, ...workspaceKey(), change.projectId],
        clientPortalQueryKey,
      ];
    case "projects":
      return [["admin", "projects"], projectsListQueryKey];
    case "projectDeleted":
      return [
        ["admin", "projects"],
        projectsListQueryKey,
        ["admin", "billings"],
        ["admin", "budgets"],
        ["admin", "assignments"],
        engagementsQueryKey,
        proposalsListQueryKey,
        ["client"],
      ];
    case "assignments":
      return [["admin", "assignments"]];
    case "applications":
      return [["admin", "applications"]];
    case "builders":
      return [["admin", "contributors"]];
    case "engagements":
      return [engagementsQueryKey, clientPortalQueryKey, meRolesQueryKey];
    case "notifications":
      return [notificationsQueryKey];
    case "settings":
      return [adminSettingsQueryKey, publicSettingsQueryKey];
  }
}

export async function refreshAfter(queryClient: QueryClient, ...changes: DataChange[]) {
  await Promise.all(
    changes.flatMap(staleKeys).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
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
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
    queryClient.invalidateQueries({ queryKey: tokensListQueryKey }),
    router.invalidate(),
  ]);
}
