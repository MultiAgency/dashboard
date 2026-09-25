type AssignmentLink = { projectId: string; nearAccount: string };

export type BillingFilterValues = {
  projectId: string;
  nearAccount: string;
};

type BillingFilterGraphInput = {
  projectIds: string[];
  assignments: AssignmentLink[];
  billingLinks?: Array<{ projectId: string; nearAccount: string | null }>;
};

type BillingFilterGraph = {
  projectToContributors: Map<string, Set<string>>;
  contributorToProjects: Map<string, Set<string>>;
};

function addToMapSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
}

function intersectSets(sets: Array<Set<string> | undefined>): Set<string> | null {
  const defined = sets.filter((s): s is Set<string> => s != null);
  if (defined.length === 0) return null;
  const [first, ...rest] = defined;
  const result = new Set(first);
  for (const set of rest) {
    for (const value of result) {
      if (!set.has(value)) result.delete(value);
    }
  }
  return result;
}

export function buildBillingFilterGraph(input: BillingFilterGraphInput): BillingFilterGraph {
  const projectToContributors = new Map<string, Set<string>>();
  const contributorToProjects = new Map<string, Set<string>>();
  const links = [...input.assignments, ...(input.billingLinks ?? [])];
  for (const { projectId, nearAccount } of links) {
    if (!nearAccount) continue;
    addToMapSet(projectToContributors, projectId, nearAccount);
    addToMapSet(contributorToProjects, nearAccount, projectId);
  }
  return { projectToContributors, contributorToProjects };
}

export function resolveBillingFilterIds(
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
  filters: BillingFilterValues,
  omit?: keyof BillingFilterValues,
) {
  const allProjects = new Set(allProjectIds);
  const allContributors = new Set(allContributorAccounts);
  const projectConstraints: Array<Set<string> | undefined> = [];
  const contributorConstraints: Array<Set<string> | undefined> = [];

  if (filters.projectId && omit !== "projectId") {
    projectConstraints.push(new Set([filters.projectId]));
    contributorConstraints.push(graph.projectToContributors.get(filters.projectId));
  }
  if (filters.nearAccount && omit !== "nearAccount") {
    contributorConstraints.push(new Set([filters.nearAccount]));
    projectConstraints.push(graph.contributorToProjects.get(filters.nearAccount));
  }

  return {
    allowedProjects: intersectSets([allProjects, ...projectConstraints]) ?? allProjects,
    allowedContributors:
      intersectSets([allContributors, ...contributorConstraints]) ?? allContributors,
  };
}

/** Dropdown options: each list is narrowed by the other filters, not its own selection. */
export function resolveBillingFilterDropdownOptions(
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
  filters: BillingFilterValues,
) {
  return {
    projects: resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      filters,
      "projectId",
    ).allowedProjects,
    contributors: resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      filters,
      "nearAccount",
    ).allowedContributors,
  };
}

/** Clear selections that are incompatible after a filter change. */
export function reconcileBillingFilters(
  prev: BillingFilterValues,
  patch: Partial<BillingFilterValues>,
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
): BillingFilterValues {
  const next = { ...prev, ...patch };
  if (next.projectId) {
    const { allowedProjects } = resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      next,
      "projectId",
    );
    if (!allowedProjects.has(next.projectId)) next.projectId = "";
  }
  if (next.nearAccount) {
    const { allowedContributors } = resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      next,
      "nearAccount",
    );
    if (!allowedContributors.has(next.nearAccount)) next.nearAccount = "";
  }
  return next;
}

export function resolveBudgetAuditFilterIds(
  allProjectIds: string[],
  allTokenIds: string[],
  filters: { projectId: string; tokenId: string },
  projectsByToken: Set<string> | null | undefined,
  tokensByProject: Set<string> | null | undefined,
  omit?: "projectId" | "tokenId",
) {
  const allProjects = new Set(allProjectIds);
  const allTokens = new Set(allTokenIds);

  const projectConstraints: Array<Set<string>> = [allProjects];
  const tokenConstraints: Array<Set<string>> = [allTokens];

  if (filters.projectId && omit !== "projectId")
    projectConstraints.push(new Set([filters.projectId]));
  if (filters.tokenId && projectsByToken?.size) projectConstraints.push(projectsByToken);
  if (filters.tokenId && omit !== "tokenId") tokenConstraints.push(new Set([filters.tokenId]));
  if (filters.projectId && tokensByProject?.size) tokenConstraints.push(tokensByProject);

  return {
    allowedProjects: intersectSets(projectConstraints) ?? allProjects,
    allowedTokens: intersectSets(tokenConstraints) ?? allTokens,
  };
}

export function resolveBudgetAuditDropdownOptions(
  allProjectIds: string[],
  allTokenIds: string[],
  filters: { projectId: string; tokenId: string },
  projectsByToken: Set<string> | null | undefined,
  tokensByProject: Set<string> | null | undefined,
) {
  return {
    projects: resolveBudgetAuditFilterIds(
      allProjectIds,
      allTokenIds,
      filters,
      projectsByToken,
      tokensByProject,
      "projectId",
    ).allowedProjects,
    tokens: resolveBudgetAuditFilterIds(
      allProjectIds,
      allTokenIds,
      filters,
      projectsByToken,
      tokensByProject,
      "tokenId",
    ).allowedTokens,
  };
}

export function reconcileBudgetAuditFilters(
  prev: { projectId: string; tokenId: string },
  patch: Partial<{ projectId: string; tokenId: string }>,
  allProjectIds: string[],
  allTokenIds: string[],
  projectsByToken: Set<string> | null | undefined,
  tokensByProject: Set<string> | null | undefined,
) {
  const next = { ...prev, ...patch };
  if (next.projectId) {
    const { allowedProjects } = resolveBudgetAuditFilterIds(
      allProjectIds,
      allTokenIds,
      next,
      projectsByToken,
      tokensByProject,
      "projectId",
    );
    if (!allowedProjects.has(next.projectId)) next.projectId = "";
  }
  if (next.tokenId) {
    const { allowedTokens } = resolveBudgetAuditFilterIds(
      allProjectIds,
      allTokenIds,
      next,
      projectsByToken,
      tokensByProject,
      "tokenId",
    );
    if (!allowedTokens.has(next.tokenId)) next.tokenId = "";
  }
  return next;
}
