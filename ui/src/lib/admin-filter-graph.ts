type AssignmentLink = { projectId: string; nearAccount: string };

type ClientLink = { id: string; projectIds: string[] };

export type BillingFilterValues = {
  projectId: string;
  nearAccount: string;
  clientId: string;
};

type BillingFilterGraphInput = {
  projectIds: string[];
  assignments: AssignmentLink[];
  clients: ClientLink[];
  /** Extra edges from billings (e.g. builder paid but not assigned). */
  billingLinks?: Array<{
    projectId: string;
    nearAccount: string | null;
    clientId: string | null;
  }>;
};

type BillingFilterGraph = {
  projectToContributors: Map<string, Set<string>>;
  contributorToProjects: Map<string, Set<string>>;
  projectToClients: Map<string, Set<string>>;
  clientToProjects: Map<string, Set<string>>;
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
  const projectToClients = new Map<string, Set<string>>();
  const clientToProjects = new Map<string, Set<string>>();

  for (const { projectId, nearAccount } of input.assignments) {
    addToMapSet(projectToContributors, projectId, nearAccount);
    addToMapSet(contributorToProjects, nearAccount, projectId);
  }

  for (const client of input.clients) {
    for (const projectId of client.projectIds) {
      addToMapSet(projectToClients, projectId, client.id);
      addToMapSet(clientToProjects, client.id, projectId);
    }
  }

  for (const link of input.billingLinks ?? []) {
    if (link.nearAccount) {
      addToMapSet(projectToContributors, link.projectId, link.nearAccount);
      addToMapSet(contributorToProjects, link.nearAccount, link.projectId);
    }
    if (link.clientId) {
      addToMapSet(projectToClients, link.projectId, link.clientId);
      addToMapSet(clientToProjects, link.clientId, link.projectId);
    }
  }

  return {
    projectToContributors,
    contributorToProjects,
    projectToClients,
    clientToProjects,
  };
}

export function resolveBillingFilterIds(
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
  allClientIds: string[],
  filters: BillingFilterValues,
  omit?: keyof BillingFilterValues,
) {
  const allProjects = new Set(allProjectIds);
  const allContributors = new Set(allContributorAccounts);
  const allClients = new Set(allClientIds);

  const projectConstraints: Array<Set<string> | undefined> = [];
  const contributorConstraints: Array<Set<string> | undefined> = [];
  const clientConstraints: Array<Set<string> | undefined> = [];

  if (filters.projectId && omit !== "projectId") {
    projectConstraints.push(new Set([filters.projectId]));
    contributorConstraints.push(graph.projectToContributors.get(filters.projectId));
    clientConstraints.push(graph.projectToClients.get(filters.projectId));
  }

  if (filters.nearAccount && omit !== "nearAccount") {
    contributorConstraints.push(new Set([filters.nearAccount]));
    projectConstraints.push(graph.contributorToProjects.get(filters.nearAccount));
    const clientIds = new Set<string>();
    for (const projectId of graph.contributorToProjects.get(filters.nearAccount) ?? []) {
      for (const clientId of graph.projectToClients.get(projectId) ?? []) {
        clientIds.add(clientId);
      }
    }
    if (clientIds.size > 0) clientConstraints.push(clientIds);
  }

  if (filters.clientId && omit !== "clientId") {
    clientConstraints.push(new Set([filters.clientId]));
    projectConstraints.push(graph.clientToProjects.get(filters.clientId));
    const contributorAccounts = new Set<string>();
    for (const projectId of graph.clientToProjects.get(filters.clientId) ?? []) {
      for (const nearAccount of graph.projectToContributors.get(projectId) ?? []) {
        contributorAccounts.add(nearAccount);
      }
    }
    if (contributorAccounts.size > 0) contributorConstraints.push(contributorAccounts);
  }

  const allowedProjects = intersectSets([allProjects, ...projectConstraints]) ?? allProjects;
  const allowedContributors =
    intersectSets([allContributors, ...contributorConstraints]) ?? allContributors;
  const allowedClients = intersectSets([allClients, ...clientConstraints]) ?? allClients;

  return { allowedProjects, allowedContributors, allowedClients };
}

/** Dropdown options: each list is narrowed by the other filters, not its own selection. */
export function resolveBillingFilterDropdownOptions(
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
  allClientIds: string[],
  filters: BillingFilterValues,
) {
  return {
    projects: resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      allClientIds,
      filters,
      "projectId",
    ).allowedProjects,
    contributors: resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      allClientIds,
      filters,
      "nearAccount",
    ).allowedContributors,
    clients: resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      allClientIds,
      filters,
      "clientId",
    ).allowedClients,
  };
}

/** Clear selections that are incompatible after a filter change. */
export function reconcileBillingFilters(
  prev: BillingFilterValues,
  patch: Partial<BillingFilterValues>,
  graph: BillingFilterGraph,
  allProjectIds: string[],
  allContributorAccounts: string[],
  allClientIds: string[],
): BillingFilterValues {
  const next = { ...prev, ...patch };

  if (next.projectId) {
    const { allowedProjects } = resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      allClientIds,
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
      allClientIds,
      next,
      "nearAccount",
    );
    if (!allowedContributors.has(next.nearAccount)) next.nearAccount = "";
  }
  if (next.clientId) {
    const { allowedClients } = resolveBillingFilterIds(
      graph,
      allProjectIds,
      allContributorAccounts,
      allClientIds,
      next,
      "clientId",
    );
    if (!allowedClients.has(next.clientId)) next.clientId = "";
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
