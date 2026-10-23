import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../../db";
import {
  type AUTO_DECISIONS,
  type CompensationRequestRow,
  compensationRequests,
  type WorkOrderEvidenceRow,
  type WorkOrderRow,
  workOrderEvidence,
  workOrderIntegrations,
  workOrders,
} from "../../db/schema";
import type { NotificationKind } from "../notifications";
import {
  type ConsistencyChecker,
  type ConsistencyResult,
  type ConsistencyVerdict,
  consistencyEvidenceOf,
} from "./consistency";
import { daysBetween } from "./time";
import {
  assessTrust,
  committedOverlaps,
  DEFAULT_TRUST,
  evidenceFacts,
  type TrustAssessment,
  type TrustDecision,
  type TrustMode,
  type TrustTier,
  trustHistoryOf,
} from "./trust";
import type { CollectedEvidence } from "./types";

export const SYSTEM_ACTOR = "system";

export type AutoDecision = (typeof AUTO_DECISIONS)[number];

export type TrustSettings = { mode: TrustMode; vetoHours: number };

export type StoredTrust = TrustAssessment & {
  ai: ConsistencyResult | null;
  assessedAt: string;
};

export type TrustView = {
  tier: TrustTier;
  score: number;
  reasons: string[];
  blockers: string[];
  decision: TrustDecision;
  suggested: TrustDecision;
  aiVerdict: ConsistencyVerdict | null;
  aiConcerns: string[];
  autoApproveAt: string | null;
  stopped: boolean;
  approvedAutomatically: boolean;
};

export type AutoApprovalDeps = {
  db: Database;
  now: () => Date;
  consistency?: ConsistencyChecker | null;
  collected: (row: WorkOrderEvidenceRow) => CollectedEvidence;
  approve: (
    row: WorkOrderRow,
    request: CompensationRequestRow,
    amount: string,
    actorId: string,
  ) => Promise<CompensationRequestRow>;
  notify: (
    row: WorkOrderRow,
    kind: NotificationKind,
    payload: Record<string, string>,
  ) => Promise<void>;
  payload: (row: WorkOrderRow, extra: Record<string, string>) => Promise<Record<string, string>>;
  display: (amount: string | bigint, tokenId: string) => string;
};

const HOUR_MS = 3_600_000;
const COMMITTED = ["approved", "paying", "proposed", "paid"];
const TIER_LABELS: Record<TrustTier, string> = {
  new: "New builder",
  established: "Established builder",
  trusted: "Trusted builder",
};

export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
  mode: DEFAULT_TRUST.mode,
  vetoHours: DEFAULT_TRUST.vetoHours,
};

export function storedTrustOf(raw: string | null): StoredTrust | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredTrust;
    return value && typeof value === "object" && typeof value.tier === "string" ? value : null;
  } catch {
    return null;
  }
}

export function trustViewOf(request: CompensationRequestRow): TrustView | null {
  const stored = storedTrustOf(request.trust);
  if (!stored) return null;
  return {
    tier: stored.tier,
    score: stored.score,
    reasons: stored.reasons,
    blockers: stored.blockers,
    decision: request.autoDecision ?? stored.decision,
    suggested: stored.suggested,
    aiVerdict: stored.ai?.verdict ?? null,
    aiConcerns: stored.ai?.concerns ?? [],
    autoApproveAt:
      request.status === "submitted" ? (request.autoApproveAt?.toISOString() ?? null) : null,
    stopped: request.autoStoppedAt !== null,
    approvedAutomatically: request.approvedBy === SYSTEM_ACTOR,
  };
}

function idsOf(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function ratio(part: bigint, whole: bigint): number {
  if (whole <= 0n) return part > 0n ? 10 : 0;
  return Number((part * 10_000n) / whole) / 10_000;
}

export function proratedCap(
  row: Pick<WorkOrderRow, "budgetAmount" | "periodStart" | "periodEnd">,
  coversFrom: string,
  coversTo: string,
): bigint {
  const budget = BigInt(row.budgetAmount);
  const periodDays = BigInt(daysBetween(row.periodStart, row.periodEnd) + 1);
  const coveredDays = BigInt(daysBetween(coversFrom, coversTo) + 1);
  if (periodDays <= 0n || coveredDays >= periodDays) return budget;
  if (coveredDays <= 0n) return 0n;
  return (budget * coveredDays + periodDays - 1n) / periodDays;
}

export function createAutoApproval(deps: AutoApprovalDeps) {
  const { db, now } = deps;

  async function settings(organizationId: string): Promise<TrustSettings> {
    const [row] = await db
      .select({
        mode: workOrderIntegrations.trustMode,
        vetoHours: workOrderIntegrations.trustVetoHours,
      })
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, organizationId))
      .limit(1);
    return row ?? DEFAULT_TRUST_SETTINGS;
  }

  async function save(
    id: string,
    patch: Partial<CompensationRequestRow> & { stored?: StoredTrust },
  ): Promise<CompensationRequestRow> {
    const { stored, ...rest } = patch;
    const [row] = await db
      .update(compensationRequests)
      .set({ ...rest, ...(stored ? { trust: JSON.stringify(stored) } : {}), updatedAt: now() })
      .where(eq(compensationRequests.id, id))
      .returning();
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Compensation request not found" });
    return row;
  }

  async function frozenEvidence(request: CompensationRequestRow): Promise<CollectedEvidence[]> {
    const ids = idsOf(request.evidenceIds);
    if (ids.length === 0) return [];
    const rows = await db
      .select()
      .from(workOrderEvidence)
      .where(
        and(
          eq(workOrderEvidence.workOrderId, request.workOrderId),
          inArray(workOrderEvidence.id, ids),
        ),
      );
    return rows.map(deps.collected);
  }

  async function assess(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    given?: TrustSettings,
  ): Promise<StoredTrust> {
    const config = given ?? (await settings(row.organizationId));
    const [history, siblings, evidence] = await Promise.all([
      trustHistoryOf(db, row.organizationId, row.builderNearAccount, {
        excludeRequestId: request.id,
      }),
      db.select().from(compensationRequests).where(eq(compensationRequests.workOrderId, row.id)),
      frozenEvidence(request),
    ]);
    const budget = BigInt(row.budgetAmount);
    const committed = siblings
      .filter((r) => r.id !== request.id && COMMITTED.includes(r.status) && r.approvedAmount)
      .reduce((total, r) => total + BigInt(r.approvedAmount ?? "0"), 0n);
    const remaining = budget > committed ? budget - committed : 0n;
    const amount = BigInt(request.requestedAmount);
    const cap = proratedCap(row, request.coversFrom, request.coversTo);
    const ai =
      config.mode === "off" || !deps.consistency
        ? null
        : await deps.consistency
            .check({
              coversFrom: request.coversFrom,
              coversTo: request.coversTo,
              summary: request.summary,
              contributionsMd: request.contributionsMd,
              assessmentMd: request.assessmentMd,
              amountToCapRatio: ratio(amount, cap),
              budgetUsedRatio: ratio(committed + amount, budget),
              evidence: consistencyEvidenceOf(evidence),
            })
            .catch((error: unknown) => {
              console.warn("[API] work order consistency check failed", error);
              return null;
            });
    const assessment = assessTrust(
      history,
      {
        amount: amount.toString(),
        proratedCap: cap.toString(),
        remaining: remaining.toString(),
        evidence: evidenceFacts(evidence),
        overlaps: committedOverlaps(request, siblings).map(
          (id) => `${row.code}-R${siblings.find((r) => r.id === id)?.seq ?? "?"}`,
        ),
        payeeConfirmed: row.payeeConfirmedAt !== null,
      },
      ai,
      { mode: config.mode, vetoHours: config.vetoHours },
      now(),
    );
    return { ...assessment, ai, assessedAt: now().toISOString() };
  }

  function trustNote(trust: StoredTrust): string {
    const tier = TIER_LABELS[trust.tier];
    if (trust.blockers.length > 0) {
      return `${tier}. Needs your approval because: ${trust.blockers.join("; ")}.`;
    }
    return `${tier}.`;
  }

  async function approveAutomatically(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    trust: StoredTrust,
    base: Record<string, string>,
  ): Promise<string | null> {
    try {
      await deps.approve(row, request, request.requestedAmount, SYSTEM_ACTOR);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    await deps.notify(row, "compensation_request_auto_approved", {
      ...base,
      tier: TIER_LABELS[trust.tier],
      approved: deps.display(request.requestedAmount, row.tokenId),
    });
    return null;
  }

  async function toManual(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    trust: StoredTrust,
    base: Record<string, string>,
    reason: string,
  ) {
    await save(request.id, { stored: trust, autoDecision: "manual", autoApproveAt: null });
    await deps.notify(row, "compensation_request_needs_approval", {
      ...base,
      tier: TIER_LABELS[trust.tier],
      reason,
    });
  }

  async function onSubmitted(
    row: WorkOrderRow,
    request: CompensationRequestRow,
    base: Record<string, string>,
  ): Promise<boolean> {
    const trust = await assess(row, request);
    if (trust.decision === "veto_window") {
      const at = new Date(now().getTime() + trust.vetoHours * HOUR_MS);
      await save(request.id, { stored: trust, autoDecision: "veto_window", autoApproveAt: at });
      await deps.notify(row, "compensation_request_auto_scheduled", {
        ...base,
        tier: TIER_LABELS[trust.tier],
        autoApproveAt: stamp(at),
      });
      return true;
    }
    if (trust.decision === "auto_pay") {
      const saved = await save(request.id, { stored: trust, autoDecision: "auto_pay" });
      const failed = await approveAutomatically(row, saved, trust, base);
      if (failed) await toManual(row, saved, trust, base, failed);
      return true;
    }
    await save(request.id, { stored: trust, autoDecision: "manual" });
    await deps.notify(row, "compensation_request_submitted", {
      ...base,
      tier: TIER_LABELS[trust.tier],
      trustNote: trustNote(trust),
    });
    return true;
  }

  async function due(at: Date = now()) {
    const counts = { approved: 0, manual: 0 };
    const pending = await db
      .select()
      .from(compensationRequests)
      .where(
        and(
          eq(compensationRequests.status, "submitted"),
          lte(compensationRequests.autoApproveAt, at),
          isNull(compensationRequests.autoStoppedAt),
        ),
      );
    for (const request of pending) {
      try {
        const [claimed] = await db
          .update(compensationRequests)
          .set({ autoApproveAt: null, updatedAt: now() })
          .where(
            and(
              eq(compensationRequests.id, request.id),
              eq(compensationRequests.status, "submitted"),
              lte(compensationRequests.autoApproveAt, at),
              isNull(compensationRequests.autoStoppedAt),
            ),
          )
          .returning();
        if (!claimed) continue;
        const [row] = await db
          .select()
          .from(workOrders)
          .where(eq(workOrders.id, claimed.workOrderId))
          .limit(1);
        if (!row) continue;
        const base = await deps.payload(row, {
          requestCode: `${row.code}-R${claimed.seq}`,
          requested: deps.display(claimed.requestedAmount, row.tokenId),
        });
        const trust = await assess(row, claimed);
        if (trust.decision !== "manual") {
          const saved = await save(claimed.id, { stored: trust, autoDecision: trust.decision });
          const failed = await approveAutomatically(row, saved, trust, base);
          if (!failed) {
            counts.approved += 1;
            continue;
          }
          await toManual(row, saved, trust, base, failed);
        } else {
          await toManual(
            row,
            claimed,
            trust,
            base,
            trust.blockers.join("; ") || "automatic approval is no longer on for this builder",
          );
        }
        counts.manual += 1;
      } catch (error) {
        console.warn(`[API] automatic approval of request ${request.id} failed`, error);
      }
    }
    return counts;
  }

  async function stop(request: CompensationRequestRow, actorId: string) {
    if (request.status !== "submitted" || !request.autoApproveAt) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This request isn't waiting to be approved automatically",
        data: { reason: "NOT_SCHEDULED" },
      });
    }
    return save(request.id, {
      autoApproveAt: null,
      autoDecision: "manual",
      autoStoppedBy: actorId,
      autoStoppedAt: now(),
    });
  }

  return { settings, assess, onSubmitted, due, stop };
}

export type AutoApproval = ReturnType<typeof createAutoApproval>;
