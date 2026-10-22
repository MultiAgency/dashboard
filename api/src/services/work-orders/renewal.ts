import type { COMPENSATION_REQUEST_STATUSES } from "../../db/schema";
import type {
  ActivitySummary,
  CollectedEvidence,
  RenewalAssessment,
  RenewalMetric,
  RenewalThresholds,
} from "./types";

type RequestStatus = (typeof COMPENSATION_REQUEST_STATUSES)[number];

const TROUBLED: readonly RequestStatus[] = ["rejected", "failed"];

export function assessRenewal(input: {
  evidence: CollectedEvidence[];
  activity: ActivitySummary;
  requests: { id: string; status: RequestStatus }[];
  thresholds: RenewalThresholds;
  periodStart: string;
  periodEnd: string;
  assessedAt: string;
}): RenewalAssessment {
  const { evidence, activity, thresholds: t } = input;
  const merged = evidence.filter((e) => e.kind === "merged_pr" || e.kind === "unlinked_pr");
  const approved = merged.filter((e) => (e.details.acceptedBy?.length ?? 0) > 0).length;
  const unapproved = merged.length - approved;
  const issues = evidence.filter(
    (e) =>
      e.kind === "assigned_issue" && e.authorized && !e.flags.includes("closed as not planned"),
  );
  const done = issues.filter((e) => e.state === "done").length;
  const troubled = input.requests.filter((r) => TROUBLED.includes(r.status));
  const weeksPct = pct(activity.weeksActive, activity.weeksInPeriod);
  const issuesPct = issues.length ? pct(done, issues.length) : null;

  const metrics: RenewalMetric[] = [
    {
      key: "active_weeks",
      label: "Weeks with accepted work",
      value: `${activity.weeksActive} of ${activity.weeksInPeriod} weeks (${weeksPct}%)`,
      target: `at least ${t.minActiveWeeksPct}%`,
      met: weeksPct >= t.minActiveWeeksPct,
    },
    {
      key: "approved_prs",
      label: "Pull requests approved by the repository owner",
      value: String(approved),
      target: `at least ${t.minApprovedPrs}`,
      met: approved >= t.minApprovedPrs,
    },
    {
      key: "issues_done",
      label: "Assigned issues done",
      value:
        issuesPct === null ? "no assigned issues" : `${done} of ${issues.length} (${issuesPct}%)`,
      target: `at least ${t.minIssuesDonePct}%`,
      met: t.minIssuesDonePct === 0 || (issuesPct !== null && issuesPct >= t.minIssuesDonePct),
    },
    {
      key: "unapproved_prs",
      label: "Merged pull requests the repository owner didn't approve",
      value: String(unapproved),
      target: t.maxUnapprovedPrs === 0 ? "none" : `at most ${t.maxUnapprovedPrs}`,
      met: unapproved <= t.maxUnapprovedPrs,
    },
    {
      key: "requests",
      label: "Compensation requests rejected or failed",
      value: troubled.length ? troubled.map((r) => `${r.id} (${r.status})`).join(", ") : "none",
      target: "none",
      met: troubled.length === 0,
    },
  ];
  return {
    assessedAt: input.assessedAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    passed: metrics.every((m) => m.met),
    metrics,
  };
}

export function renewalCode(root: string, seq: number): string {
  return `${root}-M${seq}`;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
