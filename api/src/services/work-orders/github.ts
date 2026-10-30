const API = "https://api.github.com";
const MAX_PAGES = 10;
const TIMEOUT_MS = 20_000;

export type GhPull = {
  number: number;
  title: string;
  url: string;
  merged: boolean;
  mergedAt: string | null;
  mergedBy: string | null;
  author: string;
  baseRef: string;
  body: string | null;
};

export type GhIssueRef = { repo: string; number: number; title: string; url: string };

export type GhReview = {
  author: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submittedAt: string | null;
};

export type GhRepoOwnership = {
  repo: string;
  owner: string;
  ownerType: "User" | "Organization";
  approvers: string[];
};

export type GhIssue = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  stateReason: string | null;
  createdAt: string;
  closedAt: string | null;
  assignees: string[];
};

export type GhAssignmentEvent = {
  kind: "assigned" | "unassigned";
  assignee: string;
  actor: string | null;
  at: string;
};

export type GhPullSummary = {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  author: string;
  body: string | null;
  additions: number;
  deletions: number;
};

export type GhReviewBy = {
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  state: GhReview["state"];
  submittedAt: string;
};

export type GhRepo = {
  fullName: string;
  url: string;
  description: string | null;
  pushedAt: string | null;
};

export interface GitHubPort {
  getPull(repo: string, number: number): Promise<GhPull>;
  getClosingIssues(repo: string, number: number): Promise<GhIssueRef[]>;
  listReviews(repo: string, number: number): Promise<GhReview[]>;
  getDefaultBranch(repo: string): Promise<string>;
  getRepoOwnership(repo: string): Promise<GhRepoOwnership>;
  listIssuesAssignedTo(repo: string, login: string, since: string): Promise<GhIssue[]>;
  getAssignmentEvents(repo: string, number: number): Promise<GhAssignmentEvent[]>;
  listPullsByAuthor(repo: string, login: string, since: string): Promise<GhPullSummary[]>;
  listReviewsBy(repo: string, login: string, since: string): Promise<GhReviewBy[]>;
  listOrgRepos(org: string): Promise<GhRepo[]>;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

type RestPull = {
  number: number;
  title: string;
  html_url: string;
  state?: string;
  merged?: boolean;
  merged_at: string | null;
  merged_by?: { login: string } | null;
  user: { login: string } | null;
  base: { ref: string };
  body: string | null;
  created_at?: string;
  additions?: number;
  deletions?: number;
};

type RestIssue = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  state_reason?: string | null;
  created_at: string;
  closed_at?: string | null;
  assignees?: { login: string }[] | null;
  pull_request?: unknown;
};

type RestIssueEvent = {
  event: string;
  created_at: string;
  actor?: { login: string } | null;
  assignee?: { login: string } | null;
  assigner?: { login: string } | null;
};

type RestSearchItem = {
  number: number;
  title: string;
  html_url: string;
  user?: { login: string } | null;
};

type RestRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  pushed_at: string | null;
  archived?: boolean;
  private?: boolean;
};

type RestReview = { user: { login: string } | null; state: string; submitted_at?: string | null };

type ClosingData = {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        nodes: {
          number: number;
          title: string;
          url: string;
          repository: { nameWithOwner: string };
        }[];
      } | null;
    } | null;
  } | null;
};

const CLOSING_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 25) {
        nodes { number title url repository { nameWithOwner } }
      }
    }
  }
}`;

export function createGitHub(token: string | null, fetcher: typeof fetch = fetch): GitHubPort {
  const headers = (): Record<string, string> => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "multiagency-work-orders",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  async function rest<T>(path: string): Promise<T> {
    const response = await fetcher(`${API}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok)
      throw new GitHubError(response.status, `GitHub GET ${path} → ${response.status}`);
    return (await response.json()) as T;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!token) throw new GitHubError(401, "Reading closing issues needs GITHUB_TOKEN");
    const response = await fetcher(`${API}/graphql`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new GitHubError(response.status, `GitHub GraphQL → ${response.status}`);
    const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length || !json.data) {
      throw new GitHubError(502, `GitHub GraphQL: ${json.errors?.[0]?.message ?? "no data"}`);
    }
    return json.data;
  }

  async function pages<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await rest<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  async function search(query: string): Promise<RestSearchItem[]> {
    const out: RestSearchItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await rest<{ items: RestSearchItem[] }>(
        `/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
      );
      out.push(...result.items);
      if (result.items.length < 100) break;
    }
    return out;
  }

  const split = (repo: string) => {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(`repo must be owner/name, got "${repo}"`);
    return { owner, name };
  };

  return {
    async getPull(repo, number) {
      return toPull(await rest<RestPull>(`/repos/${repo}/pulls/${number}`));
    },

    async getClosingIssues(repo, number) {
      const { owner, name } = split(repo);
      const data = await graphql<ClosingData>(CLOSING_QUERY, { owner, name, number });
      const nodes = data.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
      return nodes.map((node) => ({
        repo: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        url: node.url,
      }));
    },

    async listReviews(repo, number) {
      const reviews = await pages<RestReview>(`/repos/${repo}/pulls/${number}/reviews`);
      return reviews
        .filter((review) => review.user?.login)
        .map((review) => ({
          author: review.user?.login ?? "",
          state: review.state as GhReview["state"],
          submittedAt: review.submitted_at ?? null,
        }));
    },

    async getDefaultBranch(repo) {
      return (await rest<{ default_branch: string }>(`/repos/${repo}`)).default_branch;
    },

    async getRepoOwnership(repo) {
      const info = await rest<{ full_name: string; owner: { login: string; type: string } }>(
        `/repos/${repo}`,
      );
      if (info.owner.type !== "Organization") {
        return {
          repo: info.full_name,
          owner: info.owner.login,
          ownerType: "User",
          approvers: [info.owner.login],
        };
      }
      let admins: { login: string }[];
      try {
        admins = await pages<{ login: string }>(
          `/repos/${repo}/collaborators?permission=admin&affiliation=all`,
        );
      } catch (error) {
        if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
          throw new GitHubError(
            error.status,
            `GitHub won't list the admins of ${repo}: give GITHUB_TOKEN access to its collaborators`,
          );
        }
        throw error;
      }
      return {
        repo: info.full_name,
        owner: info.owner.login,
        ownerType: "Organization",
        approvers: admins.map((a) => a.login),
      };
    },

    async listIssuesAssignedTo(repo, login, since) {
      const issues = await pages<RestIssue>(
        `/repos/${repo}/issues?assignee=${encodeURIComponent(login)}&state=all&since=${encodeURIComponent(since)}`,
      );
      return issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          repo,
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          state: issue.state === "closed" ? "closed" : "open",
          stateReason: issue.state_reason ?? null,
          createdAt: issue.created_at,
          closedAt: issue.closed_at ?? null,
          assignees: (issue.assignees ?? []).map((a) => a.login),
        }));
    },

    async getAssignmentEvents(repo, number) {
      const events = await pages<RestIssueEvent>(`/repos/${repo}/issues/${number}/events`);
      return events
        .filter((e) => (e.event === "assigned" || e.event === "unassigned") && e.assignee?.login)
        .map((e) => ({
          kind: e.event as GhAssignmentEvent["kind"],
          assignee: e.assignee?.login ?? "",
          actor: e.assigner?.login ?? e.actor?.login ?? null,
          at: e.created_at,
        }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    },

    async listPullsByAuthor(repo, login, since) {
      const items = await search(
        `repo:${repo} is:pr author:${login} updated:>=${searchTime(since)}`,
      );
      const pulls: GhPullSummary[] = [];
      for (const item of items) {
        const pr = await rest<RestPull>(`/repos/${repo}/pulls/${item.number}`);
        pulls.push({
          repo,
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.state === "open" ? "open" : "closed",
          merged: pr.merged ?? pr.merged_at !== null,
          mergedAt: pr.merged_at,
          createdAt: pr.created_at ?? "",
          author: pr.user?.login ?? login,
          body: pr.body,
          additions: pr.additions ?? 0,
          deletions: pr.deletions ?? 0,
        });
      }
      return pulls;
    },

    async listReviewsBy(repo, login, since) {
      const items = await search(
        `repo:${repo} is:pr reviewed-by:${login} updated:>=${searchTime(since)}`,
      );
      const wanted = login.toLowerCase();
      const out: GhReviewBy[] = [];
      for (const item of items) {
        if (item.user?.login?.toLowerCase() === wanted) continue;
        const reviews = await pages<RestReview>(`/repos/${repo}/pulls/${item.number}/reviews`);
        for (const review of reviews) {
          if (review.user?.login?.toLowerCase() !== wanted || !review.submitted_at) continue;
          if (Date.parse(review.submitted_at) < Date.parse(since)) continue;
          out.push({
            repo,
            prNumber: item.number,
            prTitle: item.title,
            prUrl: item.html_url,
            state: review.state as GhReview["state"],
            submittedAt: review.submitted_at,
          });
        }
      }
      return out;
    },

    async listOrgRepos(org) {
      const repos = await pages<RestRepo>(
        `/orgs/${encodeURIComponent(org)}/repos?type=public&sort=pushed`,
      );
      return repos
        .filter((r) => !r.archived && !r.private)
        .map((r) => ({
          fullName: r.full_name,
          url: r.html_url,
          description: r.description,
          pushedAt: r.pushed_at,
        }));
    },
  };
}

export function cachedOrgRepos(github: GitHubPort, ttlMs: number, now: () => number = Date.now) {
  const cache = new Map<string, { until: number; value: Promise<GhRepo[]> }>();
  return (org: string): Promise<GhRepo[]> => {
    const key = org.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = github.listOrgRepos(org);
    cache.set(key, { until: now() + ttlMs, value });
    value.catch(() => cache.delete(key));
    return value;
  };
}

export function cachedOwnership(github: GitHubPort, ttlMs: number, now: () => number = Date.now) {
  const cache = new Map<string, { until: number; value: Promise<GhRepoOwnership> }>();
  return (repo: string): Promise<GhRepoOwnership> => {
    const key = repo.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = github.getRepoOwnership(repo);
    cache.set(key, { until: now() + ttlMs, value });
    value.catch(() => cache.delete(key));
    return value;
  };
}

function searchTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toPull(pr: RestPull): GhPull {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    merged: pr.merged ?? pr.merged_at !== null,
    mergedAt: pr.merged_at,
    mergedBy: pr.merged_by?.login ?? null,
    author: pr.user?.login ?? "ghost",
    baseRef: pr.base.ref,
    body: pr.body,
  };
}
