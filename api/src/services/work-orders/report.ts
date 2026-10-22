import { createHash } from "node:crypto";
import type { ActivitySummary, CollectedEvidence, ManualItem, WorkOrderScope } from "./types";

const DRAFT_LABEL = "_Draft: edit before submitting._";
const HASH_SEPARATOR = " · report sha256 ";

export function buildContributions(input: {
  scope: WorkOrderScope;
  evidence: CollectedEvidence[];
  activity: ActivitySummary;
  manualItems: ManualItem[];
  summary?: string | null;
}): string {
  const { scope, evidence, activity, manualItems } = input;
  const multiRepo = scope.repos.length > 1;
  const day = (at: string | null) => (at ? at.slice(5, 10) : "?");
  const ref = (repo: string | null, number: number | null, url: string) =>
    `[${multiRepo && repo ? repo : ""}#${number ?? "?"}](${url})`;
  const flags = (list: string[]) => (list.length ? ` · ⚠ ${list.join("; ")}` : "");
  const prByUrl = new Map(evidence.filter((e) => e.kind === "merged_pr").map((e) => [e.url, e]));

  const issues = evidence.filter((e) => e.kind === "assigned_issue");
  const order: Record<string, number> = { done: 0, in_progress: 1, not_started: 2 };
  issues.sort(
    (a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || (a.number ?? 0) - (b.number ?? 0),
  );
  const issueLines = issues.map((issue) => {
    const pulls = issue.details.pulls ?? [];
    const assigned = issue.assignedAt
      ? `assigned ${day(issue.assignedAt)}${issue.assignedBy ? ` by @${issue.assignedBy}` : ""}`
      : "assigned";
    const head = `${ref(issue.repo, issue.number, issue.url)} ${clean(issue.title)}`;
    if (issue.state === "done") {
      const merged = pulls
        .filter((p) => p.state === "merged")
        .map((p) => {
          const accepted = prByUrl.get(p.url)?.details.acceptedBy ?? [];
          const by = accepted.length
            ? ` (approved by ${accepted.map((l) => `@${l}`).join(", ")})`
            : "";
          return `PR ${ref(p.repo, p.number, p.url)} merged ${day(p.mergedAt)}${by}`;
        });
      const work = merged.length ? merged.join(" · ") : `closed ${day(issue.occurredAt)}`;
      return `- ✅ ${head}: ${assigned} · ${work}${flags(issue.flags)}`;
    }
    if (issue.state === "in_progress") {
      const open = pulls
        .filter((p) => p.state === "open")
        .map((p) => `PR ${ref(p.repo, p.number, p.url)} open`);
      return `- 🟡 ${head}: in progress (${open.join(", ")}) · ${assigned}${flags(issue.flags)}`;
    }
    return `- ⚪ ${head}: not started · ${assigned}${flags(issue.flags)}`;
  });

  const other = evidence
    .filter((e) => e.kind === "unlinked_pr" || (e.kind === "merged_pr" && !e.authorized))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((pr) => {
      const why =
        pr.kind === "unlinked_pr"
          ? "not linked to an assigned issue"
          : `closes ${pr.links.join(", ")}`;
      const confirmed =
        pr.kind === "unlinked_pr" && pr.authorized ? " · confirmed by the representative" : "";
      return `- PR ${ref(pr.repo, pr.number, pr.url)} ${clean(pr.title)}: merged ${day(pr.occurredAt)}, ${why}${confirmed}${flags(pr.flags)}`;
    });

  const reviews = evidence
    .filter((e) => e.kind === "review")
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((r) => ref(r.repo, r.number, r.url));

  const outputs = manualItems.map((item) => {
    const date = item.date ? `, ${item.date}` : "";
    const note = item.note ? ` · ${clean(item.note)}` : "";
    return `- [${clean(item.title)}](${item.url})${date} (added by contractor)${note}`;
  });

  const done = issues.filter((i) => i.state === "done").length;
  const progress = issues.filter((i) => i.state === "in_progress").length;
  const facts =
    `From ${scope.periodStart} to ${scope.periodEnd}, @${scope.contractorGithub} worked on ${issues.length} assigned ` +
    `issue${issues.length === 1 ? "" : "s"} (${done} done, ${progress} in progress), merged ${activity.prsMerged} ` +
    `pull request${activity.prsMerged === 1 ? "" : "s"} and reviewed ${activity.reviews}.`;
  const n = (value: number) => value.toLocaleString("en-US");
  return [
    "## Contributions",
    escapeBlock(clean(input.summary ? `${input.summary} ${facts}` : facts, true)),
    "",
    "### Authorized work (assigned GitHub issues)",
    ...(issueLines.length ? issueLines : ["- None"]),
    "",
    "### Other merged work (needs representative confirmation)",
    ...(other.length ? other : ["- None"]),
    "",
    "### Reviews",
    reviews.length ? `- Reviewed PR ${reviews.join(", ")}` : "- None",
    "",
    "### Other outputs",
    ...(outputs.length ? outputs : ["- None"]),
    "",
    "### At a glance",
    `${activity.weeksActive} of ${activity.weeksInPeriod} weeks active · ${n(activity.prsMerged)} PRs merged · ${n(activity.issuesClosed)} issues closed · ${n(activity.reviews)} reviews · +${n(activity.additions)} / −${n(activity.deletions)} lines`,
  ].join("\n");
}

export function templateAssessment(draft?: {
  objectives: string;
  lessons: string;
  challenges: string;
  recommendations: string;
}): string {
  const part = (text: string | undefined) => (text ? escapeBlock(clean(text, true)) : "…");
  return [
    DRAFT_LABEL,
    "",
    `**How the work supported the project:** ${part(draft?.objectives)}`,
    `**Lessons learned:** ${part(draft?.lessons)}`,
    `**Challenges:** ${part(draft?.challenges)}`,
    `**Recommendations:** ${part(draft?.recommendations)}`,
  ].join("\n");
}

export function renderReport(input: {
  requestId: string;
  workOrderCode: string;
  projectTitle: string;
  contractor: string;
  github: string;
  coversFrom: string;
  coversTo: string;
  budget: string;
  previouslyPaid: string;
  requested: string;
  remainingAfter: string;
  contributionsMd: string;
  assessmentMd: string;
  collectedAt: string | null;
}): string {
  return [
    `# Compensation Request ${input.requestId} · Work Order ${input.workOrderCode}`,
    `Project: ${clean(input.projectTitle)} · Contractor: ${clean(input.contractor)} (@${input.github}) · Period: ${input.coversFrom} → ${input.coversTo}`,
    `Budget: ${input.budget} · Previously paid: ${input.previouslyPaid} · Requested: ${input.requested} · Remaining after: ${input.remainingAfter}`,
    "",
    input.contributionsMd.trim(),
    "",
    "## Assessment",
    escapeBlock(input.assessmentMd.trim()),
    "",
    "---",
    `Evidence collected ${input.collectedAt ? input.collectedAt.slice(0, 10) : "never"}`,
  ].join("\n");
}

export function servedReport(
  frozen: string,
  sha256: string | null,
  paymentMd: string | null,
): string {
  const hashed = sha256 ? `${frozen}${HASH_SEPARATOR}${sha256}` : frozen;
  return paymentMd ? `${hashed}\n\n${paymentMd}` : hashed;
}

export function paymentSection(input: {
  amount: string;
  daoAccountId: string;
  proposalId: string;
  approvedBy: string;
  paidOn: string;
}): string {
  return [
    "## Payment",
    `${input.amount} · DAO proposal ${input.daoAccountId} #${input.proposalId} · approved by ${clean(input.approvedBy)} on ${input.paidOn}`,
  ].join("\n");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function clean(text: string, multiline = false): string {
  const flat = multiline ? text.replace(/\r/g, "").trim() : text.replace(/\s+/g, " ").trim();
  return flat.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

export function escapeBlock(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      /^\s{0,3}(#|>|-{3,}\s*$|={3,}\s*$|_{3,}\s*$|\*{3,}\s*$)/.test(line)
        ? `\\${line.trimStart()}`
        : line,
    )
    .join("\n");
}
