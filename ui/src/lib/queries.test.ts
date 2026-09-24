import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "./api";
import {
  adminApplicationsListQueryKey,
  adminAssignmentsForProjectQueryKey,
  adminAssignmentsListQueryKey,
  adminBillingsQueryKey,
  adminBudgetsLogQueryKey,
  adminContributorBillingsQueryKey,
  adminContributorsListQueryKey,
  adminInternalListingQueryOptions,
  adminProjectBudgetQueryOptions,
  adminProjectBudgetsLogQueryKey,
  adminProjectDetailQueryOptions,
  adminProjectsForTokenQueryKey,
  adminProjectsListQueryKey,
  adminSettingsQueryOptions,
  clientBillingsQueryKey,
  clientPortalDashboardSummaryQueryOptions,
  clientPortalProjectBudgetQueryOptions,
  clientPortalProjectsListQueryOptions,
  engagementDetailQueryOptions,
  engagementsListQueryOptions,
  meRolesQueryOptions,
  prepaidBalanceQueryOptions,
  prepaymentsListQueryOptions,
  projectsListQueryOptions,
  proposalsListQueryKey,
  publicSettingsQueryOptions,
  refreshAfter,
  setActiveOrganizationKey,
} from "./queries";

const api = {} as ApiClient;

function cacheWith(keys: Record<string, QueryKey>) {
  const queryClient = new QueryClient();
  for (const key of Object.values(keys)) queryClient.setQueryData(key, { cached: true });
  const stale = () =>
    Object.entries(keys)
      .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
      .map(([name]) => name)
      .sort();
  return { queryClient, stale };
}

describe("refreshAfter", () => {
  it("budget entries refresh the changed projects' budgets, every budget history and client budgets", async () => {
    const { queryClient, stale } = cacheWith({
      budgetA: adminProjectBudgetQueryOptions(api, "a").queryKey,
      budgetB: adminProjectBudgetQueryOptions(api, "b").queryKey,
      budgetC: adminProjectBudgetQueryOptions(api, "c").queryKey,
      agencyLog: adminBudgetsLogQueryKey({ projectId: null, tokenId: "near", engagementId: null }),
      projectLogA: adminProjectBudgetsLogQueryKey("a"),
      projectsForToken: adminProjectsForTokenQueryKey("near"),
      clientBudget: clientPortalProjectBudgetQueryOptions(api, "e1", "a").queryKey,
      clientDashboard: clientPortalDashboardSummaryQueryOptions(api, "e1").queryKey,
      engagements: engagementsListQueryOptions(api).queryKey,
    });

    await refreshAfter(queryClient, { type: "budgetEntries", projectIds: ["a", "b"] });

    expect(stale()).toEqual([
      "agencyLog",
      "budgetA",
      "budgetB",
      "clientBudget",
      "clientDashboard",
      "projectLogA",
      "projectsForToken",
    ]);
  });

  it("billings refresh billing lists, project budgets and proposal mappings", async () => {
    const { queryClient, stale } = cacheWith({
      projectBillings: adminBillingsQueryKey({ projectId: "a" }),
      clientBillings: clientBillingsQueryKey("e1", "a"),
      contributorBillings: adminContributorBillingsQueryKey("dev.near"),
      budget: adminProjectBudgetQueryOptions(api, "a").queryKey,
      proposals: proposalsListQueryKey,
      listing: adminInternalListingQueryOptions(api, "a").queryKey,
    });

    await refreshAfter(queryClient, { type: "billings" });

    expect(stale()).toEqual([
      "budget",
      "clientBillings",
      "contributorBillings",
      "projectBillings",
      "proposals",
    ]);
  });

  it("an internal listing change refreshes that project's listing and budget, and client budgets", async () => {
    const { queryClient, stale } = cacheWith({
      listingA: adminInternalListingQueryOptions(api, "a").queryKey,
      listingB: adminInternalListingQueryOptions(api, "b").queryKey,
      budgetA: adminProjectBudgetQueryOptions(api, "a").queryKey,
      budgetB: adminProjectBudgetQueryOptions(api, "b").queryKey,
      clientBudget: clientPortalProjectBudgetQueryOptions(api, "e1", "a").queryKey,
    });

    await refreshAfter(queryClient, { type: "listing", projectId: "a" });

    expect(stale()).toEqual(["budgetA", "clientBudget", "listingA"]);
  });

  it("deleting a project refreshes everything that hung off it", async () => {
    const { queryClient, stale } = cacheWith({
      adminProjects: adminProjectsListQueryKey,
      publicProjects: projectsListQueryOptions(api).queryKey,
      detail: adminProjectDetailQueryOptions(api, "site").queryKey,
      billings: adminBillingsQueryKey({ projectId: "a" }),
      clientBillings: clientBillingsQueryKey("e1", "a"),
      clientProjects: clientPortalProjectsListQueryOptions(api, "e1").queryKey,
      clientDashboard: clientPortalDashboardSummaryQueryOptions(api, "e1").queryKey,
      budgetsLog: adminProjectBudgetsLogQueryKey("a"),
      assignments: adminAssignmentsForProjectQueryKey("a"),
      engagement: engagementDetailQueryOptions(api, "e1").queryKey,
      proposals: proposalsListQueryKey,
      settings: adminSettingsQueryOptions(api).queryKey,
    });

    await refreshAfter(queryClient, { type: "projectDeleted" });

    expect(stale()).toEqual([
      "adminProjects",
      "assignments",
      "billings",
      "budgetsLog",
      "clientBillings",
      "clientDashboard",
      "clientProjects",
      "detail",
      "engagement",
      "proposals",
      "publicProjects",
    ]);
  });

  it("several changes can be announced together", async () => {
    const { queryClient, stale } = cacheWith({
      applications: adminApplicationsListQueryKey("builder", "new"),
      builders: adminContributorsListQueryKey,
      assignments: adminAssignmentsListQueryKey,
      publicSettings: publicSettingsQueryOptions(api).queryKey,
    });

    await refreshAfter(queryClient, { type: "applications" }, { type: "builders" });

    expect(stale()).toEqual(["applications", "builders"]);
  });

  it("an Engagement change refreshes Engagements, the client portal and the caller's sections", async () => {
    const { queryClient, stale } = cacheWith({
      list: engagementsListQueryOptions(api).queryKey,
      detail: engagementDetailQueryOptions(api, "e1").queryKey,
      clientProjects: clientPortalProjectsListQueryOptions(api, "e1").queryKey,
      roles: meRolesQueryOptions(api).queryKey,
      adminProjects: adminProjectsListQueryKey,
    });

    await refreshAfter(queryClient, { type: "engagements" });

    expect(stale()).toEqual(["clientProjects", "detail", "list", "roles"]);
  });

  it("prepayments refresh Prepayments and Prepaid balances, and nothing else", async () => {
    const { queryClient, stale } = cacheWith({
      list: prepaymentsListQueryOptions(api, "e1").queryKey,
      balance: prepaidBalanceQueryOptions(api, "e1").queryKey,
      engagement: engagementDetailQueryOptions(api, "e1").queryKey,
      clientDashboard: clientPortalDashboardSummaryQueryOptions(api, "e1").queryKey,
    });

    await refreshAfter(queryClient, { type: "prepayments" });

    expect(stale()).toEqual(["balance", "list"]);
  });
});

describe("workspace query keys", () => {
  it("differ per active Organization, so one Organization's cache never serves another", () => {
    setActiveOrganizationKey("agency");
    const agencyKey = adminProjectDetailQueryOptions(api, "site").queryKey;
    setActiveOrganizationKey("client");
    const clientKey = adminProjectDetailQueryOptions(api, "site").queryKey;
    setActiveOrganizationKey(null);

    expect(agencyKey).not.toEqual(clientKey);
    expect(agencyKey).toContain("agency");
    expect(clientKey).toContain("client");
  });
});
