import type { GhPull, GhRepoOwnership, GhReview, GitHubPort } from "./github";

export async function ownerApprovals(
  github: GitHubPort,
  repo: string,
  pr: GhPull,
  ownership: GhRepoOwnership,
): Promise<string[]> {
  const author = pr.author.toLowerCase();
  const approvers = new Map(ownership.approvers.map((login) => [login.toLowerCase(), login]));
  const accepted = new Map<string, string>();
  const take = (login: string | null) => {
    const key = login?.toLowerCase();
    if (key && key !== author && approvers.has(key)) accepted.set(key, approvers.get(key) ?? key);
  };
  take(pr.mergedBy);
  for (const [login, review] of latestReviews(await github.listReviews(repo, pr.number))) {
    if (review.state === "APPROVED") take(login);
  }
  return [...accepted.values()];
}

export function approverText(ownership: GhRepoOwnership): string {
  if (ownership.ownerType === "User") return `@${ownership.owner}`;
  const names = ownership.approvers.map((login) => `@${login}`).join(", ");
  return names ? `the admins of ${ownership.owner} (${names})` : `the admins of ${ownership.owner}`;
}

function latestReviews(reviews: GhReview[]): Map<string, GhReview> {
  const ordered = reviews
    .map((review, index) => ({ review, index }))
    .sort((a, b) => {
      const ta = a.review.submittedAt ? Date.parse(a.review.submittedAt) : Number.POSITIVE_INFINITY;
      const tb = b.review.submittedAt ? Date.parse(b.review.submittedAt) : Number.POSITIVE_INFINITY;
      return ta - tb || a.index - b.index;
    });
  const latest = new Map<string, GhReview>();
  for (const { review } of ordered) {
    if (review.state === "COMMENTED" || review.state === "PENDING") continue;
    latest.set(review.author.toLowerCase(), review);
  }
  return latest;
}
