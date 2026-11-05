import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db";
import {
  billings,
  type COMPENSATION_REQUEST_STATUSES,
  compensationRequests,
  type RENEWAL_STATUSES,
  workOrderEvidence,
  workOrders,
} from "../../db/schema";
import type { ConsistencyResult } from "./consistency";
import type { EvidenceKind } from "./types";

type RequestStatus = (typeof COMPENSATION_REQUEST_STATUSES)[number];
type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export type TrustTier = "new" | "established" | "trusted";
export type TrustDecision = "manual" | "veto_window" | "auto_pay";
export type TrustMode = "off" | "suggest" | "auto";

export type TrustConfig = {
  mode: TrustMode;
  establishedMinCleanPeriods: number;
  trustedMinCleanPeriods: number;
  trustedMinTenureDays: number;
  trustedFlagFreePeriods: number;
  troubleWindowDays: number;
  vetoHours: number;
  requireAi: { established: boolean; trusted: boolean };
  minAiConfidence: number;
};

export type TrustConfigInput = Partial<Omit<TrustConfig, "requireAi">> & {
  requireAi?: Partial<TrustConfig["requireAi"]>;
};

export const DEFAULT_TRUST: TrustConfig = {
  mode: "suggest",
  establishedMinCleanPeriods: 2,
  trustedMinCleanPeriods: 4,
  trustedMinTenureDays: 60,
  trustedFlagFreePeriods: 3,
  troubleWindowDays: 90,
  vetoHours: 24,
  requireAi: { established: true, trusted: false },
  minAiConfidence: 0.6,
};

export type EvidenceFacts = {
  authorized: number;
  unauthorized: number;
  flagged: number;
  unapprovedPrs: number;
  selfAssignedOnly: number;
};

export type PastRequest = {
  id: string;
  workOrderId: string;
  status: RequestStatus;
  coversFrom: string;
  coversTo: string;
  requestedAmount: string;
  approvedAmount: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  evidence: EvidenceFacts;
};

export type RenewalOutcome = {
  workOrderId: string;
  status: RenewalStatus;
  passed: boolean | null;
};

export type TrustHistory = {
  builderNearAccount: string;
  firstWorkOrderStart: string | null;
  payeePaidBefore: boolean;
  requests: PastRequest[];
  renewals: RenewalOutcome[];
};

export type CurrentRequestFacts = {
  amount: string;
  proratedCap: string;
  remaining: string;
  evidence: EvidenceFacts;
  overlaps: string[];
  payeeConfirmed: boolean;
  payeeNewToAgency?: boolean;
};

export type TrustAssessment = {
  tier: TrustTier;
  score: number;
  reasons: string[];
  blockers: string[];
  decision: TrustDecision;
  suggested: TrustDecision;
  vetoHours: number;
  cleanPeriods: number;
};

const DAY_MS = 86_400_000;
const WORK_KINDS: readonly EvidenceKind[] = [
  "assigned_issue",
  "merged_pr",
  "unlinked_pr",
  "manual",
];
const PR_KINDS: readonly EvidenceKind[] = ["merged_pr", "unlinked_pr"];
const BENIGN_FLAGS = ["closed as not planned", "assignment time unknown"];
const UNAPPROVED = "not approved by the repository owner";
const SELF_ONLY = "closes only issues the contractor assigned to themselves";
const STARTED = ["accepted", "active", "ended", "exhausted", "terminated"] as const;
const TROUBLED: readonly RequestStatus[] = ["rejected", "failed"];
const COMMITTED: readonly RequestStatus[] = ["approved", "paying", "proposed", "paid"];

export function trustConfigOf(input: TrustConfigInput = {}): TrustConfig {
  return {
    ...DEFAULT_TRUST,
    ...input,
    requireAi: { ...DEFAULT_TRUST.requireAi, ...input.requireAi },
  };
}

export function evidenceFacts(
  items: { kind: EvidenceKind; authorized: boolean; flags: string[] }[],
): EvidenceFacts {
  const facts: EvidenceFacts = {
    authorized: 0,
    unauthorized: 0,
    flagged: 0,
    unapprovedPrs: 0,
    selfAssignedOnly: 0,
  };
  for (const item of items) {
    if (WORK_KINDS.includes(item.kind)) {
      if (item.authorized) facts.authorized += 1;
      else facts.unauthorized += 1;
    }
    if (item.flags.some((flag) => !BENIGN_FLAGS.includes(flag))) facts.flagged += 1;
    if (PR_KINDS.includes(item.kind) && item.flags.some((flag) => flag.startsWith(UNAPPROVED))) {
      facts.unapprovedPrs += 1;
    }
    if (item.flags.includes(SELF_ONLY)) facts.selfAssignedOnly += 1;
  }
  return facts;
}

export function isCleanPeriod(request: PastRequest, siblings: PastRequest[]): boolean {
  if (request.status !== "paid") return false;
  if (request.evidence.authorized === 0 || request.evidence.unapprovedPrs > 0) return false;
  return !siblings.some(
    (other) =>
      other.id !== request.id &&
      other.workOrderId === request.workOrderId &&
      TROUBLED.includes(other.status) &&
      other.coversFrom <= request.coversTo &&
      other.coversTo >= request.coversFrom,
  );
}

export function assessTrust(
  history: TrustHistory,
  current: CurrentRequestFacts,
  ai: ConsistencyResult | null,
  configInput: TrustConfigInput = {},
  now: Date = new Date(),
): TrustAssessment {
  const config = trustConfigOf(configInput);
  const reasons: string[] = [];
  const blockers: string[] = [];

  const paid = history.requests
    .filter((r) => r.status === "paid")
    .sort((a, b) => (a.coversTo < b.coversTo ? 1 : a.coversTo > b.coversTo ? -1 : 0));
  const clean = paid.filter((r) => isCleanPeriod(r, history.requests));
  const troubleSince = now.getTime() - config.troubleWindowDays * DAY_MS;
  const recentTrouble = history.requests.filter(
    (r) => TROUBLED.includes(r.status) && instantOf(r) >= troubleSince,
  );
  const allTrouble = history.requests.filter((r) => TROUBLED.includes(r.status));
  const tenureDays = history.firstWorkOrderStart
    ? Math.max(
        0,
        Math.floor(
          (now.getTime() - Date.parse(`${history.firstWorkOrderStart}T00:00:00Z`)) / DAY_MS,
        ),
      )
    : 0;
  const lastPeriods = paid.slice(0, config.trustedFlagFreePeriods);
  const flagFree =
    lastPeriods.length >= config.trustedFlagFreePeriods &&
    lastPeriods.every((r) => r.evidence.flagged === 0);
  const renewalsPassed = history.renewals.filter(
    (r) => r.status === "renewed" || r.passed === true,
  ).length;
  const renewalsDeclined = history.renewals.filter((r) => r.status === "declined").length;

  reasons.push(
    `${clean.length} clean paid ${plural(clean.length, "period")} of ${paid.length} paid with this agency`,
  );
  reasons.push(`${tenureDays} ${plural(tenureDays, "day")} since the first work order started`);

  let tier: TrustTier;
  if (recentTrouble.length > 0) {
    tier = "new";
    reasons.push(
      `${recentTrouble.length} rejected or failed ${plural(recentTrouble.length, "request")} in the last ${config.troubleWindowDays} days`,
    );
  } else if (
    clean.length >= config.trustedMinCleanPeriods &&
    tenureDays >= config.trustedMinTenureDays &&
    flagFree
  ) {
    tier = "trusted";
    reasons.push(
      `No flagged evidence in the last ${config.trustedFlagFreePeriods} paid ${plural(config.trustedFlagFreePeriods, "period")}`,
    );
  } else if (clean.length >= config.establishedMinCleanPeriods) {
    tier = "established";
    if (clean.length >= config.trustedMinCleanPeriods) {
      if (tenureDays < config.trustedMinTenureDays) {
        reasons.push(`Trusted needs at least ${config.trustedMinTenureDays} days with the agency`);
      }
      if (!flagFree) {
        reasons.push(
          `Trusted needs ${config.trustedFlagFreePeriods} recent paid periods without flagged evidence`,
        );
      }
    } else {
      reasons.push(`Trusted needs ${config.trustedMinCleanPeriods} clean paid periods`);
    }
  } else {
    tier = "new";
    reasons.push(`Established needs ${config.establishedMinCleanPeriods} clean paid periods`);
  }
  if (renewalsPassed > 0) {
    reasons.push(`${renewalsPassed} ${plural(renewalsPassed, "renewal")} passed`);
  }
  if (renewalsDeclined > 0) {
    reasons.push(`${renewalsDeclined} ${plural(renewalsDeclined, "renewal")} declined`);
  }

  const amount = BigInt(current.amount);
  if (current.evidence.authorized === 0) {
    blockers.push("No authorized evidence for this period");
  }
  if (amount > BigInt(current.proratedCap)) {
    blockers.push("Requested amount is above the cap for the covered dates");
  }
  if (amount > BigInt(current.remaining)) {
    blockers.push("Requested amount is above the remaining budget");
  }
  if (current.overlaps.length > 0) {
    blockers.push(`Covered dates overlap with ${current.overlaps.join(", ")}`);
  }
  if (current.evidence.unapprovedPrs > 0) {
    blockers.push(
      `${current.evidence.unapprovedPrs} merged pull ${plural(current.evidence.unapprovedPrs, "request")} not approved by the repository owner`,
    );
  }
  if (current.evidence.selfAssignedOnly > 0) {
    blockers.push(
      `${current.evidence.selfAssignedOnly} pull ${plural(current.evidence.selfAssignedOnly, "request")} closing only self-assigned issues`,
    );
  }
  if (current.payeeNewToAgency === true || !history.payeePaidBefore) {
    blockers.push("The payee account has never been paid by this agency");
  }
  if (!current.payeeConfirmed) {
    blockers.push("The payee account is not confirmed");
  }

  let aiDowngrade = false;
  if (ai === null) {
    const required = tier === "trusted" ? config.requireAi.trusted : config.requireAi.established;
    if (tier !== "new" && required) {
      blockers.push("The AI consistency check is unavailable");
    } else if (tier === "trusted") {
      aiDowngrade = true;
      reasons.push("The AI consistency check is unavailable, so payment waits for the veto window");
    }
  } else if (ai.verdict !== "consistent" || ai.confidence < config.minAiConfidence) {
    blockers.push(
      ai.verdict === "consistent"
        ? `The AI consistency check is unsure (confidence ${ai.confidence.toFixed(2)})`
        : `The AI consistency check found ${ai.verdict === "inconsistent" ? "the report inconsistent with the evidence" : "concerns"}`,
    );
    for (const concern of ai.concerns) reasons.push(`AI concern: ${concern}`);
  } else {
    reasons.push("The AI consistency check found the report consistent with the evidence");
  }

  const suggested: TrustDecision =
    blockers.length > 0 || tier === "new"
      ? "manual"
      : tier === "trusted" && !aiDowngrade
        ? "auto_pay"
        : "veto_window";
  const decision: TrustDecision = config.mode === "auto" ? suggested : "manual";
  if (config.mode === "off") reasons.push("Automatic approval is off for this agency");
  if (config.mode === "suggest" && suggested !== "manual") {
    reasons.push("Automatic approval is in suggest mode, so an admin approves");
  }

  const score = clampScore(
    Math.min(clean.length, 6) * 9 +
      Math.min(tenureDays / 180, 1) * 20 +
      (flagFree ? 15 : 0) +
      Math.min(renewalsPassed, 2) * 5 -
      recentTrouble.length * 25 -
      (allTrouble.length - recentTrouble.length) * 5 -
      renewalsDeclined * 10 -
      paid.filter((r) => r.evidence.flagged > 0).length * 4 +
      (history.payeePaidBefore ? 6 : 0),
  );

  return {
    tier,
    score,
    reasons,
    blockers,
    decision,
    suggested,
    vetoHours: suggested === "veto_window" ? config.vetoHours : 0,
    cleanPeriods: clean.length,
  };
}

export async function trustHistoryOf(
  db: Database,
  organizationId: string,
  builderNearAccount: string,
  options: { excludeRequestId?: string } = {},
): Promise<TrustHistory> {
  const orders = await db
    .select({
      id: workOrders.id,
      projectId: workOrders.projectId,
      status: workOrders.status,
      periodStart: workOrders.periodStart,
      renewalStatus: workOrders.renewalStatus,
      renewalAssessment: workOrders.renewalAssessment,
    })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.organizationId, organizationId),
        eq(workOrders.builderNearAccount, builderNearAccount),
      ),
    );
  const started = orders.filter((o) => (STARTED as readonly string[]).includes(o.status));
  const firstWorkOrderStart =
    started.map((o) => o.periodStart).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0] ?? null;
  const renewals: RenewalOutcome[] = orders.flatMap((o) =>
    o.renewalStatus
      ? [{ workOrderId: o.id, status: o.renewalStatus, passed: passedOf(o.renewalAssessment) }]
      : [],
  );
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) {
    return {
      builderNearAccount,
      firstWorkOrderStart,
      payeePaidBefore: false,
      requests: [],
      renewals,
    };
  }

  const [rows, evidence] = await Promise.all([
    db.select().from(compensationRequests).where(inArray(compensationRequests.workOrderId, ids)),
    db
      .select({
        id: workOrderEvidence.id,
        workOrderId: workOrderEvidence.workOrderId,
        kind: workOrderEvidence.kind,
        authorized: workOrderEvidence.authorized,
        flags: workOrderEvidence.flags,
        occurredAt: workOrderEvidence.occurredAt,
      })
      .from(workOrderEvidence)
      .where(inArray(workOrderEvidence.workOrderId, ids)),
  ]);

  const requests: PastRequest[] = rows
    .filter((r) => r.id !== options.excludeRequestId)
    .map((r) => {
      const linked = parseList(r.evidenceIds);
      const items = evidence
        .filter((e) =>
          linked
            ? linked.includes(e.id)
            : e.workOrderId === r.workOrderId &&
              e.occurredAt !== null &&
              dateOf(e.occurredAt) >= r.coversFrom &&
              dateOf(e.occurredAt) <= r.coversTo,
        )
        .map((e) => ({ kind: e.kind, authorized: e.authorized, flags: parseList(e.flags) ?? [] }));
      return {
        id: r.id,
        workOrderId: r.workOrderId,
        status: r.status,
        coversFrom: r.coversFrom,
        coversTo: r.coversTo,
        requestedAmount: r.requestedAmount,
        approvedAmount: r.approvedAmount,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        paidAt: r.paidAt?.toISOString() ?? null,
        evidence: evidenceFacts(items),
      };
    });

  const paidRequest = requests.some((r) => r.status === "paid");
  const projectIds = [...new Set(orders.map((o) => o.projectId))];
  const paidBilling = paidRequest
    ? []
    : await db
        .select({ id: billings.id })
        .from(billings)
        .where(
          and(
            eq(billings.nearAccount, builderNearAccount),
            inArray(billings.projectId, projectIds),
          ),
        )
        .limit(1);

  return {
    builderNearAccount,
    firstWorkOrderStart,
    payeePaidBefore: paidRequest || paidBilling.length > 0,
    requests,
    renewals,
  };
}

export function committedOverlaps(
  request: { id: string; coversFrom: string; coversTo: string },
  others: { id: string; status: RequestStatus; coversFrom: string; coversTo: string }[],
): string[] {
  return others
    .filter(
      (other) =>
        other.id !== request.id &&
        COMMITTED.includes(other.status) &&
        other.coversFrom <= request.coversTo &&
        other.coversTo >= request.coversFrom,
    )
    .map((other) => other.id);
}

function instantOf(request: PastRequest): number {
  const at = request.decidedAt ?? request.submittedAt;
  return at ? Date.parse(at) : Date.parse(`${request.coversTo}T00:00:00Z`);
}

function passedOf(assessment: string | null): boolean | null {
  if (!assessment) return null;
  try {
    const value = JSON.parse(assessment) as { passed?: unknown };
    return typeof value.passed === "boolean" ? value.passed : null;
  } catch {
    return null;
  }
}

function parseList(text: string | null): string[] | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

function dateOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
