import type { EVIDENCE_KINDS } from "../../db/schema";

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type PullLink = {
  number: number;
  url: string;
  state: "merged" | "open";
  mergedAt: string | null;
  repo: string;
};

export type EvidenceDetails = {
  body?: string | null;
  additions?: number;
  deletions?: number;
  acceptedBy?: string[];
  pulls?: PullLink[];
};

export type CollectedEvidence = {
  kind: EvidenceKind;
  repo: string | null;
  number: number | null;
  url: string;
  title: string;
  state: string;
  occurredAt: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  authorized: boolean;
  flags: string[];
  links: string[];
  details: EvidenceDetails;
};

export type ActivitySummary = {
  weeksActive: number;
  weeksInPeriod: number;
  prsMerged: number;
  issuesClosed: number;
  reviews: number;
  additions: number;
  deletions: number;
};

export type ManualItem = {
  title: string;
  url: string;
  date: string | null;
  note: string | null;
};

export type WorkOrderScope = {
  code: string;
  contractorGithub: string;
  repos: string[];
  periodStart: string;
  periodEnd: string;
  graceDays: number;
  timeZone?: string;
};

export type RenewalThresholds = {
  minActiveWeeksPct: number;
  minApprovedPrs: number;
  minIssuesDonePct: number;
  maxUnapprovedPrs: number;
};

export type RenewalMetric = {
  key: "active_weeks" | "approved_prs" | "issues_done" | "unapproved_prs" | "requests";
  label: string;
  value: string;
  target: string;
  met: boolean;
};

export type RenewalAssessment = {
  assessedAt: string;
  periodStart: string;
  periodEnd: string;
  passed: boolean;
  metrics: RenewalMetric[];
};

export const DEFAULT_RENEWAL: RenewalThresholds = {
  minActiveWeeksPct: 50,
  minApprovedPrs: 2,
  minIssuesDonePct: 50,
  maxUnapprovedPrs: 0,
};
