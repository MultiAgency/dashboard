import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "./api";
import {
  adminApplicationsListQueryKey,
  adminAssignmentsForProjectQueryKey,
  adminAssignmentsListQueryKey,
  adminBillingsQueryKey,
  adminBudgetsLogQueryKey,
  adminClientDetailQueryOptions,
  adminClientsListQueryKey,
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
  clientPortalProjectsListQueryKey,
  projectsListQueryOptions,
  proposalsListQueryKey,
  publicSettingsQueryOptions,
  refreshAfter,
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
      agencyLog: adminBudgetsLogQueryKey({ projectId: null, tokenId: "near", clientId: null }),
      projectLogA: adminProjectBudgetsLogQueryKey("a"),
      projectsForToken: adminProjectsForTokenQueryKey("near"),
      clientBudget: clientPortalProjectBudgetQueryOptions(api, "dao.near", "a").queryKey,
      clientDashboard: clientPortalDashboardSummaryQueryOptions(api, "dao.near").queryKey,
      clients: adminClientsListQueryKey,
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
      clientBillings: clientBillingsQueryKey({ projectId: "a" }),
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
      clientBudget: clientPortalProjectBudgetQueryOptions(api, "dao.near", "a").queryKey,
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
      clientBillings: clientBillingsQueryKey({ projectId: "a" }),
      clientProjects: [...clientPortalProjectsListQueryKey, "mainnet", "dao.near"],
      clientDashboard: clientPortalDashboardSummaryQueryOptions(api, "dao.near").queryKey,
      budgetsLog: adminProjectBudgetsLogQueryKey("a"),
      assignments: adminAssignmentsForProjectQueryKey("a"),
      clientDetail: adminClientDetailQueryOptions(api, "c1").queryKey,
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
      "clientDetail",
      "clientProjects",
      "detail",
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
});
