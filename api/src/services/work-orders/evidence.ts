import { approverText, ownerApprovals } from "./approval";
import type { GhIssue, GhPullSummary, GhRepoOwnership, GhReviewBy, GitHubPort } from "./github";
import { addDays, daysBetween, startOfDay, windowOf } from "./time";
import type { ActivitySummary, CollectedEvidence, EvidenceDetails, WorkOrderScope } from "./types";

const BODY_LIMIT = 4_000;
const ASSIGNMENT_LOOKBACK_MS = 365 * 86_400_000;

type Assigned = {
  issue: GhIssue;
  assignedAt: string | null;
  assignedBy: string | null;
  self: boolean;
};

type RepoData = {
  repo: string;
  defaultBranch: string;
  ownership: GhRepoOwnership;
  pulls: GhPullSummary[];
  reviews: GhReviewBy[];
};

export async function collectEvidence(
  scope: WorkOrderScope,
  ctx: {
    github: GitHubPort;
    ownership: (repo: string) => Promise<GhRepoOwnership>;
    onRepoError?: (repo: string, error: unknown) => void;
  },
): Promise<CollectedEvidence[]> {
  const { github } = ctx;
  const { from, to } = windowOf(scope);
  const [fromMs, toMs] = [Date.parse(from), Date.parse(to)];
  const assignCutoffMs = startOfDay(addDays(scope.periodEnd, 1), scope.timeZone) - 1;
  const inWindow = (at: string | null) =>
    at !== null && Date.parse(at) >= fromMs && Date.parse(at) <= toMs;
  const login = scope.contractorGithub.toLowerCase();
  const out: CollectedEvidence[] = [];
  const repos: RepoData[] = [];
  const assigned = new Map<string, Assigned>();

  for (const repo of scope.repos) {
    try {
      const [issues, pulls, reviews, defaultBranch, ownership] = await Promise.all([
        github.listIssuesAssignedTo(
          repo,
          scope.contractorGithub,
          new Date(fromMs - ASSIGNMENT_LOOKBACK_MS).toISOString(),
        ),
        github.listPullsByAuthor(repo, scope.contractorGithub, from),
        github.listReviewsBy(repo, scope.contractorGithub, from),
        github.getDefaultBranch(repo),
        ctx.ownership(repo),
      ]);
      const found = new Map<string, Assigned>();
      for (const issue of issues) {
        if (issue.closedAt && Date.parse(issue.closedAt) < fromMs) continue;
        const events = await github.getAssignmentEvents(repo, issue.number);
        const first = events
          .filter((e) => e.kind === "assigned" && e.assignee.toLowerCase() === login)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
        if (first && Date.parse(first.at) > assignCutoffMs) continue;
        const stillAssigned = issue.assignees.some((a) => a.toLowerCase() === login);
        if (!first && !stillAssigned) continue;
        found.set(issueKey(issue.repo, issue.number), {
          issue,
          assignedAt: first?.at ?? null,
          assignedBy: first?.actor ?? null,
          self: first?.actor?.toLowerCase() === login,
        });
      }
      for (const [key, value] of found) assigned.set(key, value);
      repos.push({ repo, defaultBranch, ownership, pulls, reviews });
    } catch (error) {
      if (!ctx.onRepoError) throw error;
      ctx.onRepoError(repo, error);
    }
  }

  const linkedPulls = new Map<string, NonNullable<EvidenceDetails["pulls"]>>();
  for (const { repo, defaultBranch, ownership, pulls } of repos) {
    try {
      for (const summary of pulls) {
        const open = summary.state === "open";
        const merged = summary.merged && inWindow(summary.mergedAt);
        if (!open && !merged) continue;
        const closes = await github.getClosingIssues(repo, summary.number);
        const linked = closes.filter((ref) => assigned.has(issueKey(ref.repo, ref.number)));
        for (const ref of linked) {
          const list = linkedPulls.get(issueKey(ref.repo, ref.number)) ?? [];
          list.push({
            number: summary.number,
            url: summary.url,
            state: open ? "open" : "merged",
            mergedAt: summary.mergedAt,
            repo,
          });
          linkedPulls.set(issueKey(ref.repo, ref.number), list);
        }
        if (open) continue;

        const pr = await github.getPull(repo, summary.number);
        if (!pr.merged || pr.baseRef !== defaultBranch) continue;
        const acceptedBy = await ownerApprovals(github, repo, pr, ownership);
        const accepted = acceptedBy.length > 0;
        const flags: string[] = [];
        for (const ref of linked) {
          const at = assigned.get(issueKey(ref.repo, ref.number))?.assignedAt;
          if (at && Date.parse(summary.createdAt) < Date.parse(at)) {
            flags.push("PR opened before the issue was assigned");
            break;
          }
        }
        if (linked.length === 0 && !accepted) continue;
        if (!accepted)
          flags.push(`not approved by the repository owner (${approverText(ownership)})`);
        const authorizedIssue = linked.some(
          (ref) => !assigned.get(issueKey(ref.repo, ref.number))?.self,
        );
        if (linked.length > 0 && !authorizedIssue) {
          flags.push("closes only issues the contractor assigned to themselves");
        }
        out.push({
          kind: linked.length > 0 ? "merged_pr" : "unlinked_pr",
          repo,
          number: summary.number,
          url: summary.url,
          title: summary.title,
          state: "merged",
          occurredAt: summary.mergedAt,
          assignedAt: null,
          assignedBy: null,
          authorized: linked.length > 0 && accepted && authorizedIssue,
          flags,
          links: linked.map((ref) =>
            sameRepo(ref.repo, repo) ? `#${ref.number}` : `${ref.repo}#${ref.number}`,
          ),
          details: {
            body: truncate(summary.body),
            additions: summary.additions,
            deletions: summary.deletions,
            acceptedBy,
          },
        });
      }
    } catch (error) {
      if (!ctx.onRepoError) throw error;
      ctx.onRepoError(repo, error);
    }
  }

  for (const { issue, assignedAt, assignedBy, self } of assigned.values()) {
    const prs = linkedPulls.get(issueKey(issue.repo, issue.number)) ?? [];
    const notPlanned = issue.state === "closed" && issue.stateReason === "not_planned";
    const done = issue.state === "closed" && !notPlanned;
    const state = done
      ? "done"
      : !notPlanned && prs.some((p) => p.state === "open")
        ? "in_progress"
        : "not_started";
    const flags: string[] = [];
    if (notPlanned) flags.push("closed as not planned");
    if (!assignedAt) flags.push("assignment time unknown");
    if (self) flags.push("assigned by the contractor themselves");
    out.push({
      kind: "assigned_issue",
      repo: issue.repo,
      number: issue.number,
      url: issue.url,
      title: issue.title,
      state,
      occurredAt: issue.state === "closed" ? issue.closedAt : assignedAt,
      assignedAt,
      assignedBy,
      authorized: !self,
      flags,
      links: [],
      details: { pulls: prs },
    });
  }

  for (const { reviews } of repos) out.push(...reviewEvidence(reviews, inWindow));
  return out;
}

function reviewEvidence(
  reviews: GhReviewBy[],
  inWindow: (at: string | null) => boolean,
): CollectedEvidence[] {
  const latest = new Map<string, GhReviewBy>();
  for (const review of reviews) {
    if (review.state === "PENDING" || !inWindow(review.submittedAt)) continue;
    const previous = latest.get(review.prUrl);
    if (!previous || Date.parse(review.submittedAt) > Date.parse(previous.submittedAt)) {
      latest.set(review.prUrl, review);
    }
  }
  return [...latest.values()].map((review) => ({
    kind: "review" as const,
    repo: review.repo,
    number: review.prNumber,
    url: review.prUrl,
    title: review.prTitle,
    state: review.state.toLowerCase(),
    occurredAt: review.submittedAt,
    assignedAt: null,
    assignedBy: null,
    authorized: true,
    flags: [],
    links: [],
    details: {},
  }));
}

export function summarizeActivity(
  evidence: CollectedEvidence[],
  scope: Pick<WorkOrderScope, "periodStart" | "periodEnd" | "timeZone">,
): ActivitySummary {
  const weeksInPeriod = Math.max(
    1,
    Math.ceil((daysBetween(scope.periodStart, scope.periodEnd) + 1) / 7),
  );
  const start = startOfDay(scope.periodStart, scope.timeZone);
  const weeks = new Set<number>();
  let prsMerged = 0;
  let issuesClosed = 0;
  let reviews = 0;
  let additions = 0;
  let deletions = 0;
  for (const item of evidence) {
    const active =
      item.kind === "merged_pr" ||
      item.kind === "unlinked_pr" ||
      item.kind === "review" ||
      (item.kind === "assigned_issue" && item.state === "done");
    if (item.kind === "merged_pr" || item.kind === "unlinked_pr") {
      prsMerged += 1;
      additions += item.details.additions ?? 0;
      deletions += item.details.deletions ?? 0;
    }
    if (item.kind === "assigned_issue" && item.state === "done") issuesClosed += 1;
    if (item.kind === "review") reviews += 1;
    if (active && item.occurredAt) {
      const week = Math.floor((Date.parse(item.occurredAt) - start) / (7 * 86_400_000));
      if (week >= 0) weeks.add(Math.min(week, weeksInPeriod - 1));
    }
  }
  return {
    weeksActive: weeks.size,
    weeksInPeriod,
    prsMerged,
    issuesClosed,
    reviews,
    additions,
    deletions,
  };
}

function issueKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function truncate(text: string | null): string | null {
  if (!text) return null;
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text;
}
