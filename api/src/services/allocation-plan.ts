import { and, asc, eq, gt, gte, isNull, lte, max, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db";
import {
  type AllocationPlanApplicationRow,
  type AllocationPlanLineRow,
  allocationPlanApplications,
  allocationPlanLines,
  type ChangeOrderItemRow,
  type ChangeOrderRow,
  changeOrderItems,
  changeOrders,
  type EngagementRow,
  engagementProjects,
} from "../db/schema";
import { BudgetInsufficientError, EngagementBudgetError, writeEngagementEntries } from "./budgets";
import type { BillingStatuses } from "./ledger";

export type ShortfallLine = { projectId: string; tokenId: string; amount: string; reason: string };

export type ChangeOrderOutcome = {
  changeOrder: ChangeOrderRow;
  failureReason: string | null;
};

export type PlanApplication = {
  period: string;
  shortfall: ShortfallLine[];
  changeOrders: ChangeOrderOutcome[];
};

export class ChangeOrderApplyError extends Error {
  constructor(
    readonly reason: "PLAN_BELOW_ZERO" | "NOT_SHARED" | "NOT_ACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "ChangeOrderApplyError";
  }
}

export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export async function appliedPeriods(
  db: Database,
  engagementId: string,
): Promise<AllocationPlanApplicationRow[]> {
  return db
    .select()
    .from(allocationPlanApplications)
    .where(eq(allocationPlanApplications.engagementId, engagementId))
    .orderBy(asc(allocationPlanApplications.period));
}

export async function nextPeriod(db: Database, engagementId: string, now: Date): Promise<string> {
  const first = addMonths(periodOf(now), 1);
  const applied = new Set(
    (
      await db
        .select({ period: allocationPlanApplications.period })
        .from(allocationPlanApplications)
        .where(
          and(
            eq(allocationPlanApplications.engagementId, engagementId),
            gte(allocationPlanApplications.period, first),
          ),
        )
    ).map((r) => r.period),
  );
  let period = first;
  while (applied.has(period)) period = addMonths(period, 1);
  return period;
}

export async function currentPlanLines(
  db: Database,
  engagementId: string,
): Promise<AllocationPlanLineRow[]> {
  return db
    .select()
    .from(allocationPlanLines)
    .where(
      and(
        eq(allocationPlanLines.engagementId, engagementId),
        isNull(allocationPlanLines.supersededBy),
      ),
    )
    .orderBy(asc(allocationPlanLines.position), asc(allocationPlanLines.id));
}

const superseder = alias(changeOrders, "superseder");

export async function planForPeriod(
  db: Database,
  engagementId: string,
  period: string,
): Promise<AllocationPlanLineRow[]> {
  const rows = await db
    .select({ line: allocationPlanLines })
    .from(allocationPlanLines)
    .leftJoin(superseder, eq(superseder.id, allocationPlanLines.supersededBy))
    .where(
      and(
        eq(allocationPlanLines.engagementId, engagementId),
        lte(allocationPlanLines.effectiveFrom, period),
        or(isNull(allocationPlanLines.supersededBy), gt(superseder.effectivePeriod, period)),
      ),
    )
    .orderBy(asc(allocationPlanLines.position), asc(allocationPlanLines.id));
  return rows.map((r) => r.line);
}

export async function itemsOf(db: Database, changeOrderId: string): Promise<ChangeOrderItemRow[]> {
  return db
    .select()
    .from(changeOrderItems)
    .where(eq(changeOrderItems.changeOrderId, changeOrderId))
    .orderBy(asc(changeOrderItems.position));
}

export async function pendingItems(
  db: Database,
  engagementId: string,
): Promise<ChangeOrderItemRow[]> {
  const rows = await db
    .select({ item: changeOrderItems })
    .from(changeOrderItems)
    .innerJoin(changeOrders, eq(changeOrders.id, changeOrderItems.changeOrderId))
    .where(and(eq(changeOrders.engagementId, engagementId), eq(changeOrders.status, "approved")));
  return rows.map((r) => r.item);
}

async function sharedProjectIds(db: Database, engagementId: string): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: engagementProjects.projectId })
    .from(engagementProjects)
    .where(eq(engagementProjects.engagementId, engagementId));
  return new Set(rows.map((r) => r.projectId));
}

async function applyPlanChanges(
  tx: Database,
  changeOrder: ChangeOrderRow,
  items: ChangeOrderItemRow[],
  effectiveFrom: string,
) {
  const deltas = new Map<string, { projectId: string; tokenId: string; delta: bigint }>();
  for (const item of items) {
    if (item.kind !== "plan_change" || !item.projectId) continue;
    const key = `${item.projectId}\u0000${item.tokenId}`;
    const current = deltas.get(key);
    deltas.set(key, {
      projectId: item.projectId,
      tokenId: item.tokenId,
      delta: (current?.delta ?? 0n) + BigInt(item.amount),
    });
  }
  if (deltas.size === 0) return;
  const shared = await sharedProjectIds(tx, changeOrder.engagementId);
  const lines = await currentPlanLines(tx, changeOrder.engagementId);
  const [top] = await tx
    .select({ position: max(allocationPlanLines.position) })
    .from(allocationPlanLines)
    .where(eq(allocationPlanLines.engagementId, changeOrder.engagementId));
  let nextPosition = (top?.position ?? -1) + 1;
  for (const { projectId, tokenId, delta } of deltas.values()) {
    const line = lines.find((l) => l.projectId === projectId && l.tokenId === tokenId);
    const amount = BigInt(line?.amount ?? "0") + delta;
    if (amount < 0n) {
      throw new ChangeOrderApplyError(
        "PLAN_BELOW_ZERO",
        "The Allocation plan cannot go below zero for a Project.",
      );
    }
    if (amount > 0n && !shared.has(projectId)) {
      throw new ChangeOrderApplyError(
        "NOT_SHARED",
        "The Project is not shared through this Engagement.",
      );
    }
    if (line) {
      await tx
        .update(allocationPlanLines)
        .set({ supersededBy: changeOrder.id })
        .where(eq(allocationPlanLines.id, line.id));
    }
    if (amount > 0n) {
      await tx.insert(allocationPlanLines).values({
        id: crypto.randomUUID(),
        engagementId: changeOrder.engagementId,
        projectId,
        tokenId,
        amount: amount.toString(),
        position: line?.position ?? nextPosition++,
        effectiveFrom,
        changeOrderId: changeOrder.id,
      });
    }
  }
}

export function failureReasonOf(err: unknown): string | null {
  if (err instanceof EngagementBudgetError || err instanceof ChangeOrderApplyError) {
    return err.reason;
  }
  if (err instanceof BudgetInsufficientError) return "BUDGET_INSUFFICIENT";
  return null;
}

export async function applyChangeOrder(
  tx: Database,
  engagement: EngagementRow,
  changeOrder: ChangeOrderRow,
  input: {
    actorAccountId: string;
    effectivePeriod: string;
    now: Date;
    statuses: BillingStatuses;
  },
): Promise<ChangeOrderOutcome> {
  const items = await itemsOf(tx, changeOrder.id);
  try {
    await tx.transaction(async (savepoint) => {
      if (engagement.status !== "active") {
        throw new ChangeOrderApplyError(
          "NOT_ACTIVE",
          "Change orders apply only on an active Engagement.",
        );
      }
      await applyPlanChanges(savepoint as Database, changeOrder, items, input.effectivePeriod);
      await writeEngagementEntries(savepoint as Database, {
        engagementId: engagement.id,
        actorAccountId: input.actorAccountId,
        statuses: input.statuses,
        entries: items.flatMap((item) =>
          item.kind === "one_off_move" && item.projectId
            ? [
                {
                  projectId: item.projectId,
                  tokenId: item.tokenId,
                  amount: item.amount,
                  note: changeOrder.note ?? "Change order",
                },
              ]
            : [],
        ),
      });
    });
  } catch (err) {
    const failureReason = failureReasonOf(err);
    if (!failureReason) throw err;
    const [failed] = await tx
      .update(changeOrders)
      .set({
        status: "failed",
        failureReason,
        effectivePeriod: input.effectivePeriod,
        updatedAt: input.now,
      })
      .where(eq(changeOrders.id, changeOrder.id))
      .returning();
    return { changeOrder: failed!, failureReason };
  }
  const [applied] = await tx
    .update(changeOrders)
    .set({
      status: "applied",
      effectivePeriod: input.effectivePeriod,
      appliedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(changeOrders.id, changeOrder.id))
    .returning();
  return { changeOrder: applied!, failureReason: null };
}

export async function applyPlanForPeriod(
  tx: Database,
  engagement: EngagementRow,
  input: {
    period: string;
    prepaymentId: string;
    actorAccountId: string;
    now: Date;
    statuses: BillingStatuses;
  },
): Promise<PlanApplication | null> {
  const [claimed] = await tx
    .insert(allocationPlanApplications)
    .values({
      engagementId: engagement.id,
      period: input.period,
      prepaymentId: input.prepaymentId,
      appliedAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  if (!claimed) return null;

  const pending = await tx
    .select()
    .from(changeOrders)
    .where(
      and(
        eq(changeOrders.engagementId, engagement.id),
        eq(changeOrders.status, "approved"),
        lte(changeOrders.effectivePeriod, input.period),
      ),
    )
    .orderBy(asc(changeOrders.decidedAt), asc(changeOrders.id));
  const outcomes: ChangeOrderOutcome[] = [];
  for (const changeOrder of pending) {
    outcomes.push(
      await applyChangeOrder(tx, engagement, changeOrder, {
        actorAccountId: input.actorAccountId,
        effectivePeriod: changeOrder.effectivePeriod ?? input.period,
        now: input.now,
        statuses: input.statuses,
      }),
    );
  }

  const shortfall: ShortfallLine[] = [];
  for (const line of await planForPeriod(tx, engagement.id, input.period)) {
    try {
      await writeEngagementEntries(tx, {
        engagementId: engagement.id,
        actorAccountId: input.actorAccountId,
        statuses: input.statuses,
        entries: [
          {
            projectId: line.projectId,
            tokenId: line.tokenId,
            amount: line.amount,
            note: `Allocation plan ${input.period}`,
          },
        ],
      });
    } catch (err) {
      const reason = failureReasonOf(err);
      if (!reason) throw err;
      shortfall.push({
        projectId: line.projectId,
        tokenId: line.tokenId,
        amount: line.amount,
        reason,
      });
    }
  }
  if (shortfall.length > 0) {
    await tx
      .update(allocationPlanApplications)
      .set({ shortfall: JSON.stringify(shortfall) })
      .where(
        and(
          eq(allocationPlanApplications.engagementId, engagement.id),
          eq(allocationPlanApplications.period, input.period),
        ),
      );
  }
  return { period: input.period, shortfall, changeOrders: outcomes };
}

export function parseShortfall(raw: string): ShortfallLine[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ShortfallLine[]) : [];
  } catch {
    return [];
  }
}
