import type {
  GhAssignmentEvent,
  GhIssue,
  GhIssueRef,
  GhPull,
  GhPullSummary,
  GhRepo,
  GhRepoOwnership,
  GhReview,
  GhReviewBy,
  GitHubPort,
} from "../../src/services/work-orders/github";
import { GitHubError } from "../../src/services/work-orders/github";

type PullRec = {
  pull: GhPull;
  closing: GhIssueRef[];
  reviews: GhReview[];
  createdAt: string;
  state: "open" | "closed";
};

type IssueRec = { issue: GhIssue; events: GhAssignmentEvent[] };

type RepoRec = {
  name: string;
  userOwner: string | null;
  admins: string[];
  pulls: Map<number, PullRec>;
  issues: Map<number, IssueRec>;
};

export class FakeGitHub implements GitHubPort {
  repos = new Map<string, RepoRec>();
  orgs = new Map<string, GhRepo[]>();
  calls: string[] = [];
  private failures = new Map<string, Error[]>();

  addRepo(name: string, opts: { admins?: string[]; userOwner?: string } = {}): this {
    this.repos.set(name.toLowerCase(), {
      name,
      userOwner: opts.userOwner ?? null,
      admins: opts.admins ?? ["maint-gh"],
      pulls: new Map(),
      issues: new Map(),
    });
    return this;
  }

  issue(repo: string, number: number, opts: { title?: string } = {}) {
    const r = this.mustRepo(repo);
    const rec: IssueRec = {
      issue: {
        repo: r.name,
        number,
        title: opts.title ?? `Issue ${number}`,
        url: `https://github.com/${r.name}/issues/${number}`,
        state: "open",
        stateReason: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        closedAt: null,
        assignees: [],
      },
      events: [],
    };
    r.issues.set(number, rec);
    const builder = {
      assign: (login: string, at: string, actor: string | null = "maint-gh") => {
        rec.events.push({ kind: "assigned", assignee: login, actor, at });
        if (!rec.issue.assignees.includes(login)) rec.issue.assignees.push(login);
        return builder;
      },
      close: (at: string, reason: "completed" | "not_planned" = "completed") => {
        Object.assign(rec.issue, { state: "closed", closedAt: at, stateReason: reason });
        return builder;
      },
    };
    return builder;
  }

  pull(
    repo: string,
    number: number,
    opts: {
      author: string;
      createdAt: string;
      mergedAt: string | null;
      mergedBy?: string | null;
      closes?: number[];
      title?: string;
    },
  ) {
    const r = this.mustRepo(repo);
    const rec: PullRec = {
      pull: {
        number,
        title: opts.title ?? `PR ${number}`,
        url: `https://github.com/${r.name}/pull/${number}`,
        merged: opts.mergedAt !== null,
        mergedAt: opts.mergedAt,
        mergedBy: opts.mergedAt ? (opts.mergedBy === undefined ? "maint-gh" : opts.mergedBy) : null,
        author: opts.author,
        baseRef: "main",
        body: null,
      },
      closing: (opts.closes ?? []).map((n) => ({
        repo: r.name,
        number: n,
        title: `Issue ${n}`,
        url: `https://github.com/${r.name}/issues/${n}`,
      })),
      reviews: [],
      createdAt: opts.createdAt,
      state: opts.mergedAt ? "closed" : "open",
    };
    r.pulls.set(number, rec);
    const builder = {
      review: (author: string, state: GhReview["state"], submittedAt: string) => {
        rec.reviews.push({ author, state, submittedAt });
        return builder;
      },
    };
    return builder;
  }

  failNext(method: string, error: Error, times = 1): void {
    const list = this.failures.get(method) ?? [];
    for (let i = 0; i < times; i++) list.push(error);
    this.failures.set(method, list);
  }

  async listOrgRepos(org: string): Promise<GhRepo[]> {
    this.enter("listOrgRepos");
    const repos = this.orgs.get(org.toLowerCase());
    if (!repos) throw new GitHubError(404, `GitHub GET /orgs/${org}/repos → 404`);
    return structuredClone(repos);
  }

  private enter(method: string) {
    this.calls.push(method);
    const error = this.failures.get(method)?.shift();
    if (error) throw error;
  }

  private mustRepo(repo: string): RepoRec {
    const r = this.repos.get(repo.toLowerCase());
    if (!r) throw new Error(`GitHub 404: repo ${repo} not found`);
    return r;
  }

  private mustPull(repo: string, number: number): PullRec {
    const p = this.mustRepo(repo).pulls.get(number);
    if (!p) throw new Error(`GitHub 404: ${repo}#${number} not found`);
    return p;
  }

  async getPull(repo: string, number: number) {
    this.enter("getPull");
    return structuredClone(this.mustPull(repo, number).pull);
  }

  async getClosingIssues(repo: string, number: number) {
    this.enter("getClosingIssues");
    return structuredClone(this.mustPull(repo, number).closing);
  }

  async listReviews(repo: string, number: number) {
    this.enter("listReviews");
    return structuredClone(this.mustPull(repo, number).reviews);
  }

  async getDefaultBranch(repo: string) {
    this.enter("getDefaultBranch");
    this.mustRepo(repo);
    return "main";
  }

  async getRepoOwnership(repo: string): Promise<GhRepoOwnership> {
    this.enter("getRepoOwnership");
    const r = this.mustRepo(repo);
    if (r.userOwner) {
      return { repo: r.name, owner: r.userOwner, ownerType: "User", approvers: [r.userOwner] };
    }
    return {
      repo: r.name,
      owner: r.name.split("/")[0] ?? r.name,
      ownerType: "Organization",
      approvers: r.admins,
    };
  }

  async listIssuesAssignedTo(repo: string, login: string) {
    this.enter("listIssuesAssignedTo");
    const me = login.toLowerCase();
    return [...this.mustRepo(repo).issues.values()]
      .filter((r) => r.issue.assignees.some((a) => a.toLowerCase() === me))
      .map((r) => structuredClone(r.issue));
  }

  async getAssignmentEvents(repo: string, number: number) {
    this.enter("getAssignmentEvents");
    return structuredClone(this.mustRepo(repo).issues.get(number)?.events ?? []);
  }

  async listPullsByAuthor(repo: string, login: string): Promise<GhPullSummary[]> {
    this.enter("listPullsByAuthor");
    const r = this.mustRepo(repo);
    return [...r.pulls.values()]
      .filter((p) => p.pull.author.toLowerCase() === login.toLowerCase())
      .map((p) => ({
        repo: r.name,
        number: p.pull.number,
        title: p.pull.title,
        url: p.pull.url,
        state: p.state,
        merged: p.pull.merged,
        mergedAt: p.pull.mergedAt,
        createdAt: p.createdAt,
        author: p.pull.author,
        body: null,
        additions: 10,
        deletions: 2,
      }));
  }

  async listReviewsBy(repo: string, login: string): Promise<GhReviewBy[]> {
    this.enter("listReviewsBy");
    const r = this.mustRepo(repo);
    const out: GhReviewBy[] = [];
    for (const p of r.pulls.values()) {
      if (p.pull.author.toLowerCase() === login.toLowerCase()) continue;
      for (const review of p.reviews) {
        if (review.author.toLowerCase() !== login.toLowerCase() || !review.submittedAt) continue;
        out.push({
          repo: r.name,
          prNumber: p.pull.number,
          prTitle: p.pull.title,
          prUrl: p.pull.url,
          state: review.state,
          submittedAt: review.submittedAt,
        });
      }
    }
    return out;
  }
}
