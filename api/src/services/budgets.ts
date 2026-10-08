import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import {
  type Budget,
  type BudgetRevision,
  budgetRevisions,
  budgets,
  type ClientAgreement,
  clientAgreements,
  engagementProjects,
  engagements,
  organizationDaos,
} from "../db/schema";
import { clientEngagementIdsForProject } from "./agreements";
import {
  type BillingStatuses,
  type ChainStatusFetcher,
  prefetchBillingStatuses,
  projectSpend,
} from "./ledger";
import type { TreasuryScope } from "./organization-access";
import { lockEngagement, prepaidBalances } from "./prepaid-balance";
import type { ProjectDirectory } from "./project-directory";

// The Allocation plan and Change orders are omitted for now. Budget entries are allocated to
// the Project, and a Client sees the budget of every Project shared with them. Recording a
// Prepayment no longer writes Budget entries. The code stays in place; set this to true to
// bring the plan-driven flow back.
export const ALLOCATION_PLAN_ENABLED: boolean = false;

export class BudgetInsufficientError extends Error {
  constructor(
    readonly projectId: string,
    readonly tokenId: string,
    readonly currentSum: bigint,
    readonly delta: bigint,
  ) {
    super(
      `Insufficient budget for project=${projectId} token=${tokenId}: sum=${currentSum.toString()} delta=${delta.toString()} would go negative`,
    );
    this.name = "BudgetInsufficientError";
  }
}

export class BudgetEntryError extends Error {
  constructor(
    readonly reason: "NOT_FOUND" | "TRANSFER_NOT_EDITABLE" | "AMOUNT_NOT_POSITIVE",
    message: string,
  ) {
    super(message);
    this.name = "BudgetEntryError";
  }
}

export type EngagementBudgetReason =
  | "ENGAGEMENT_ATTRIBUTED"
  | "ENGAGEMENT_NOT_FOUND"
  | "NOT_ACTIVE"
  | "NO_AGENCY_DAO"
  | "NOT_SHARED"
  | "PREPAID_BALANCE_EXCEEDED"
  | "ATTRIBUTED_BUDGET_EXCEEDED"
  | "REMAINING_EXCEEDED";

export class EngagementBudgetError extends Error {
  constructor(
    readonly reason: EngagementBudgetReason,
    message: string,
  ) {
    super(message);
    this.name = "EngagementBudgetError";
  }
}

type LockedSums = { total: bigint; own: bigint; byEngagement: Map<string, bigint> };

function add(map: Map<string, bigint>, key: string, amount: bigint) {
  map.set(key, (map.get(key) ?? 0n) + amount);
}

async function lockedBudgetSums(
  tx: Database,
  projectId: string,
  tokenId: string,
): Promise<LockedSums> {
  const rows = await tx
    .select({ amount: budgets.amount, engagementId: budgets.engagementId })
    .from(budgets)
    .where(and(eq(budgets.projectId, projectId), eq(budgets.tokenId, tokenId)))
    .for("update");
  const sums: LockedSums = { total: 0n, own: 0n, byEngagement: new Map() };
  for (const row of rows) {
    const amount = BigInt(row.amount);
    sums.total += amount;
    if (row.engagementId === null) sums.own += amount;
    else add(sums.byEngagement, row.engagementId, amount);
  }
  return sums;
}

function requireOwnBudget(sums: LockedSums, projectId: string, tokenId: string, delta: bigint) {
  if (sums.total + delta < 0n) {
    throw new BudgetInsufficientError(projectId, tokenId, sums.total, delta);
  }
  // Omitted for now: without Change orders, Engagement-attributed budget moves like the Agency's own.
  if (ALLOCATION_PLAN_ENABLED && sums.own + delta < 0n) {
    throw new EngagementBudgetError(
      "ENGAGEMENT_ATTRIBUTED",
      `Only ${sums.own.toString()} of this Project's ${tokenId} budget is the Agency's own. The rest is attributed to Engagements and moves only through Change orders.`,
    );
  }
}

export type BudgetListItem = Pick<
  Budget,
  | "id"
  | "projectId"
  | "tokenId"
  | "amount"
  | "note"
  | "actorAccountId"
  | "relatedBudgetId"
  | "engagementId"
  | "fundingDaoAccountId"
  | "effectiveOn"
  | "agreementId"
  | "createdAt"
> & { lastEdit: BudgetEdit | null };

export type BudgetEdit = {
  changedAt: Date;
  changedBy: string;
  previousAmount: string;
  previousNote: string | null;
  previousEffectiveOn: string | null;
};

export interface ListBudgetsInput {
  projectIds: string[] | null;
  tokenId?: string;
  engagementId?: string;
  cursor?: string;
  limit: number;
}

export interface ListBudgetsOutput {
  data: BudgetListItem[];
  nextCursor: string | null;
}

export async function listBudgets(
  db: Database,
  input: ListBudgetsInput,
): Promise<ListBudgetsOutput> {
  if (input.projectIds !== null && input.projectIds.length === 0)
    return { data: [], nextCursor: null };

  const rows = await db
    .select({
      id: budgets.id,
      projectId: budgets.projectId,
      tokenId: budgets.tokenId,
      amount: budgets.amount,
      note: budgets.note,
      actorAccountId: budgets.actorAccountId,
      relatedBudgetId: budgets.relatedBudgetId,
      engagementId: budgets.engagementId,
      fundingDaoAccountId: budgets.fundingDaoAccountId,
      effectiveOn: budgets.effectiveOn,
      agreementId: budgets.agreementId,
      createdAt: budgets.createdAt,
    })
    .from(budgets)
    .where(
      and(
        input.projectIds !== null ? inArray(budgets.projectId, input.projectIds) : undefined,
        input.tokenId ? eq(budgets.tokenId, input.tokenId) : undefined,
        input.engagementId ? eq(budgets.engagementId, input.engagementId) : undefined,
        cursorWhere(budgets.createdAt, budgets.id, input.cursor),
      ),
    )
    .orderBy(desc(budgets.createdAt), desc(budgets.id))
    .limit(input.limit);

  const edits =
    rows.length > 0
      ? await db
          .select()
          .from(budgetRevisions)
          .where(
            and(
              inArray(
                budgetRevisions.budgetId,
                rows.map((r) => r.id),
              ),
              eq(budgetRevisions.action, "edited"),
            ),
          )
          .orderBy(desc(budgetRevisions.changedAt), desc(budgetRevisions.id))
      : [];
  const lastEdit = new Map<string, BudgetEdit>();
  for (const edit of edits) {
    if (lastEdit.has(edit.budgetId)) continue;
    lastEdit.set(edit.budgetId, {
      changedAt: edit.changedAt,
      changedBy: edit.changedBy,
      previousAmount: edit.amount,
      previousNote: edit.note,
      previousEffectiveOn: edit.effectiveOn,
    });
  }

  const last = rows[rows.length - 1];
  return {
    data: rows.map((row) => ({ ...row, lastEdit: lastEdit.get(row.id) ?? null })),
    nextCursor: rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
  };
}

async function lockBudget(tx: Database, id: string): Promise<Budget | null> {
  const [row] = await tx.select().from(budgets).where(eq(budgets.id, id)).for("update");
  return row ?? null;
}

async function recordRevision(
  tx: Database,
  row: Budget,
  action: BudgetRevision["action"],
  changedBy: string,
) {
  await tx.insert(budgetRevisions).values({
    id: crypto.randomUUID(),
    budgetId: row.id,
    action,
    projectId: row.projectId,
    tokenId: row.tokenId,
    amount: row.amount,
    note: row.note,
    effectiveOn: row.effectiveOn,
    relatedBudgetId: row.relatedBudgetId,
    engagementId: row.engagementId,
    fundingDaoAccountId: row.fundingDaoAccountId,
    agreementId: row.agreementId,
    actorAccountId: row.actorAccountId,
    budgetCreatedAt: row.createdAt,
    changedBy,
  });
}

export interface EditBudgetInput {
  id: string;
  amount?: string;
  note?: string | null;
  effectiveOn?: string | null;
  agreementId?: string | null;
  actorAccountId: string;
}

export async function editBudget(db: Database, input: EditBudgetInput): Promise<Budget> {
  return db.transaction(async (tx) => {
    const row = await lockBudget(tx as Database, input.id);
    if (!row) throw new BudgetEntryError("NOT_FOUND", "Budget entry not found");
    if (row.relatedBudgetId) {
      throw new BudgetEntryError(
        "TRANSFER_NOT_EDITABLE",
        "A transfer can't be edited. Delete it and transfer again.",
      );
    }
    if (input.amount !== undefined && BigInt(input.amount) <= 0n) {
      throw new BudgetEntryError(
        "AMOUNT_NOT_POSITIVE",
        "The amount must be more than zero. Delete the entry instead.",
      );
    }
    const amount =
      input.amount === undefined
        ? row.amount
        : row.amount.startsWith("-")
          ? `-${input.amount}`
          : input.amount;
    const note = input.note === undefined ? row.note : input.note?.trim() || null;
    const effectiveOn = input.effectiveOn === undefined ? row.effectiveOn : input.effectiveOn;
    const agreementId = input.agreementId === undefined ? row.agreementId : input.agreementId;
    if (
      amount === row.amount &&
      note === row.note &&
      effectiveOn === row.effectiveOn &&
      agreementId === row.agreementId
    ) {
      return row;
    }

    const delta = BigInt(amount) - BigInt(row.amount);
    if (delta !== 0n) {
      const sums = await lockedBudgetSums(tx as Database, row.projectId, row.tokenId);
      requireOwnBudget(sums, row.projectId, row.tokenId, delta);
    }
    await recordRevision(tx as Database, row, "edited", input.actorAccountId);
    const [updated] = await tx
      .update(budgets)
      .set({ amount, note, effectiveOn, agreementId })
      .where(eq(budgets.id, row.id))
      .returning();
    if (!updated) throw new Error("budgets update returned no row");
    return updated;
  });
}

export async function deleteBudget(
  db: Database,
  input: { id: string; actorAccountId: string },
): Promise<{ deleted: number }> {
  return db.transaction(async (tx) => {
    const row = await lockBudget(tx as Database, input.id);
    if (!row) throw new BudgetEntryError("NOT_FOUND", "Budget entry not found");
    const related = row.relatedBudgetId
      ? await lockBudget(tx as Database, row.relatedBudgetId)
      : null;
    const rows = related ? [row, related] : [row];
    for (const entry of rows) {
      const delta = -BigInt(entry.amount);
      if (delta < 0n) {
        const sums = await lockedBudgetSums(tx as Database, entry.projectId, entry.tokenId);
        requireOwnBudget(sums, entry.projectId, entry.tokenId, delta);
      }
    }
    for (const entry of rows) {
      await recordRevision(tx as Database, entry, "deleted", input.actorAccountId);
    }
    await tx.delete(budgets).where(
      inArray(
        budgets.id,
        rows.map((r) => r.id),
      ),
    );
    return { deleted: rows.length };
  });
}

export async function listDeletedBudgets(
  db: Database,
  input: { projectIds: string[] | null; limit: number },
): Promise<BudgetRevision[]> {
  if (input.projectIds !== null && input.projectIds.length === 0) return [];
  return db
    .select()
    .from(budgetRevisions)
    .where(
      and(
        eq(budgetRevisions.action, "deleted"),
        input.projectIds !== null
          ? inArray(budgetRevisions.projectId, input.projectIds)
          : undefined,
      ),
    )
    .orderBy(desc(budgetRevisions.changedAt), desc(budgetRevisions.id))
    .limit(input.limit);
}

export interface CreateBudgetInput {
  projectId: string;
  tokenId: string;
  amount: string;
  note: string | null;
  actorAccountId: string;
  fundingDaoAccountId?: string | null;
  effectiveOn?: string | null;
  agreementId?: string | null;
}

export async function createBudget(db: Database, input: CreateBudgetInput): Promise<Budget> {
  const [row] = await db
    .insert(budgets)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      tokenId: input.tokenId,
      amount: input.amount,
      note: input.note,
      actorAccountId: input.actorAccountId,
      fundingDaoAccountId: input.fundingDaoAccountId ?? null,
      effectiveOn: input.effectiveOn ?? null,
      agreementId: input.agreementId ?? null,
    })
    .returning();
  if (!row) throw new Error("budgets insert returned no row");
  return row;
}

export async function deallocateBudget(db: Database, input: CreateBudgetInput): Promise<Budget> {
  const delta = -BigInt(input.amount);
  return db.transaction(async (tx) => {
    const sums = await lockedBudgetSums(tx as Database, input.projectId, input.tokenId);
    requireOwnBudget(sums, input.projectId, input.tokenId, delta);
    return createBudget(tx as Database, { ...input, amount: delta.toString() });
  });
}

export interface TransferBudgetInput {
  fromProjectId: string;
  toProjectId: string;
  tokenId: string;
  amount: string;
  note: string | null;
  actorAccountId: string;
  fundingDaoAccountId?: string | null;
  effectiveOn?: string | null;
}

export async function transferBudget(
  db: Database,
  input: TransferBudgetInput,
): Promise<{ from: Budget; to: Budget }> {
  const amount = BigInt(input.amount);
  const fromId = crypto.randomUUID();
  const toId = crypto.randomUUID();
  const createdAt = new Date();
  return db.transaction(async (tx) => {
    const sums = await lockedBudgetSums(tx as Database, input.fromProjectId, input.tokenId);
    requireOwnBudget(sums, input.fromProjectId, input.tokenId, -amount);
    const shared = {
      tokenId: input.tokenId,
      note: input.note,
      actorAccountId: input.actorAccountId,
      fundingDaoAccountId: input.fundingDaoAccountId ?? null,
      effectiveOn: input.effectiveOn ?? null,
      createdAt,
    };
    const inserted = await tx
      .insert(budgets)
      .values([
        {
          ...shared,
          id: fromId,
          projectId: input.fromProjectId,
          amount: (-amount).toString(),
          relatedBudgetId: toId,
        },
        {
          ...shared,
          id: toId,
          projectId: input.toProjectId,
          amount: amount.toString(),
          relatedBudgetId: fromId,
        },
      ])
      .returning();
    const from = inserted.find((r) => r.id === fromId);
    const to = inserted.find((r) => r.id === toId);
    if (!from || !to) throw new Error("budgets transfer insert returned incomplete rows");
    return { from, to };
  });
}

export type EngagementEntryInput = {
  projectId: string;
  tokenId: string;
  amount: string;
  note: string | null;
};

export async function prefetchEngagementStatuses(
  db: Database,
  engagementId: string,
  entries: { projectId: string | null; amount: string }[],
  fetchStatus?: ChainStatusFetcher,
): Promise<BillingStatuses> {
  const projectIds = entries.flatMap((entry) =>
    entry.projectId !== null && BigInt(entry.amount) < 0n ? [entry.projectId] : [],
  );
  if (projectIds.length === 0) return new Map();
  const [dao] = await db
    .select({ daoAccountId: organizationDaos.daoAccountId })
    .from(engagements)
    .innerJoin(
      organizationDaos,
      eq(organizationDaos.organizationId, engagements.agencyOrganizationId),
    )
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!dao) return new Map();
  return prefetchBillingStatuses(db, { daoAccountId: dao.daoAccountId, projectIds }, fetchStatus);
}

async function checkEngagementEntries(
  tx: Database,
  engagementId: string,
  entries: EngagementEntryInput[],
  statuses: BillingStatuses,
): Promise<string> {
  const engagement = await lockEngagement(tx, engagementId);
  if (!engagement) {
    throw new EngagementBudgetError("ENGAGEMENT_NOT_FOUND", "Engagement not found");
  }
  if (engagement.status !== "active") {
    throw new EngagementBudgetError(
      "NOT_ACTIVE",
      "Budget entries can only be attributed to an active Engagement.",
    );
  }
  const [dao] = await tx
    .select({ daoAccountId: organizationDaos.daoAccountId })
    .from(organizationDaos)
    .where(eq(organizationDaos.organizationId, engagement.agencyOrganizationId))
    .limit(1);
  if (!dao) {
    throw new EngagementBudgetError(
      "NO_AGENCY_DAO",
      "The Agency has no Agency DAO to fund Budget entries from.",
    );
  }
  const shared = new Set(
    (
      await tx
        .select({ projectId: engagementProjects.projectId })
        .from(engagementProjects)
        .where(eq(engagementProjects.engagementId, engagementId))
    ).map((r) => r.projectId),
  );
  const byToken = new Map<string, bigint>();
  const byProjectToken = new Map<string, EngagementEntryInput & { delta: bigint }>();
  for (const entry of entries) {
    if (!shared.has(entry.projectId)) {
      throw new EngagementBudgetError(
        "NOT_SHARED",
        "The Project is not shared through this Engagement.",
      );
    }
    add(byToken, entry.tokenId, BigInt(entry.amount));
    const key = `${entry.projectId}\u0000${entry.tokenId}`;
    const current = byProjectToken.get(key);
    byProjectToken.set(key, { ...entry, delta: (current?.delta ?? 0n) + BigInt(entry.amount) });
  }
  const ordered = [...byProjectToken.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, { projectId, tokenId, delta }] of ordered) {
    const sums = await lockedBudgetSums(tx, projectId, tokenId);
    if ((sums.byEngagement.get(engagementId) ?? 0n) + delta < 0n) {
      throw new EngagementBudgetError(
        "ATTRIBUTED_BUDGET_EXCEEDED",
        `The Engagement has less ${tokenId} budget on this Project than that.`,
      );
    }
    if (sums.total + delta < 0n) {
      throw new BudgetInsufficientError(projectId, tokenId, sums.total, delta);
    }
    if (delta < 0n) {
      const spent = await projectSpend(tx, {
        projectId,
        tokenId,
        payingDaoAccountId: dao.daoAccountId,
        statuses,
      });
      if (sums.total - spent + delta < 0n) {
        throw new EngagementBudgetError(
          "REMAINING_EXCEEDED",
          `Only ${(sums.total - spent).toString()} of this Project's ${tokenId} budget is not yet Allocated, Committed or Paid.`,
        );
      }
    }
  }
  const balances = await prepaidBalances(tx, engagementId);
  for (const [tokenId, delta] of byToken) {
    if ((balances.get(tokenId) ?? 0n) - delta < 0n) {
      throw new EngagementBudgetError(
        "PREPAID_BALANCE_EXCEEDED",
        `The Prepaid balance in ${tokenId} does not cover this.`,
      );
    }
  }
  return dao.daoAccountId;
}

export async function writeEngagementEntries(
  db: Database,
  input: {
    engagementId: string;
    actorAccountId: string;
    entries: EngagementEntryInput[];
    statuses: BillingStatuses;
  },
): Promise<Budget[]> {
  if (input.entries.length === 0) return [];
  return db.transaction(async (tx) => {
    const fundingDaoAccountId = await checkEngagementEntries(
      tx as Database,
      input.engagementId,
      input.entries,
      input.statuses,
    );
    const createdAt = new Date();
    return tx
      .insert(budgets)
      .values(
        input.entries.map((entry) => ({
          ...entry,
          id: crypto.randomUUID(),
          actorAccountId: input.actorAccountId,
          engagementId: input.engagementId,
          fundingDaoAccountId,
          createdAt,
        })),
      )
      .returning();
  });
}

export async function resolveAgreement(
  db: Database,
  organizationId: string | null,
  input: { projectId: string; tokenId: string; agreementId?: string | null },
): Promise<ClientAgreement | null> {
  if (!input.agreementId) return null;
  const engagementIds = await clientEngagementIdsForProject(db, organizationId, input.projectId);
  const [agreement] = await db
    .select()
    .from(clientAgreements)
    .where(eq(clientAgreements.id, input.agreementId))
    .limit(1);
  if (!agreement || !engagementIds.includes(agreement.engagementId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "That agreement doesn't cover this project",
      data: { reason: "AGREEMENT_NOT_FOR_PROJECT" },
    });
  }
  if (agreement.tokenId !== input.tokenId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The budget's token must match the agreement's token",
      data: { reason: "AGREEMENT_TOKEN_MISMATCH" },
    });
  }
  return agreement;
}

const toOrpcError = (err: unknown) =>
  err instanceof ORPCError
    ? err
    : err instanceof BudgetEntryError
      ? err.reason === "NOT_FOUND"
        ? new ORPCError("NOT_FOUND", { message: err.message })
        : new ORPCError("BAD_REQUEST", { message: err.message, data: { reason: err.reason } })
      : err instanceof BudgetInsufficientError
        ? new ORPCError("BAD_REQUEST", { message: err.message })
        : err instanceof EngagementBudgetError
          ? new ORPCError("BAD_REQUEST", { message: err.message, data: { reason: err.reason } })
          : new ORPCError("INTERNAL_SERVER_ERROR", {
              message: err instanceof Error ? err.message : String(err),
            });

const engagementNotFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });

export function createBudgetsService(db: Database, directory: ProjectDirectory) {
  const engagementProjectIds = async (scope: TreasuryScope, engagementId: string) => {
    const [engagement] = await db
      .select({ id: engagements.id })
      .from(engagements)
      .where(
        and(
          eq(engagements.id, engagementId),
          scope.organizationId
            ? eq(engagements.agencyOrganizationId, scope.organizationId)
            : undefined,
        ),
      )
      .limit(1);
    if (!engagement || !scope.organizationId) throw engagementNotFound();
    const rows = await db
      .select({ projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .where(eq(engagementProjects.engagementId, engagementId));
    return rows.map((r) => r.projectId);
  };

  const entryInAgency = async (scope: TreasuryScope, id: string) => {
    const [row] = await db
      .select({ projectId: budgets.projectId, tokenId: budgets.tokenId })
      .from(budgets)
      .where(eq(budgets.id, id))
      .limit(1);
    if (!row) throw new BudgetEntryError("NOT_FOUND", "Budget entry not found");
    await directory.forAgency(scope).require(row.projectId);
    return row;
  };

  const inAgency = <A>(scope: TreasuryScope, projectIds: string[], run: () => Promise<A>) =>
    Effect.tryPromise({
      try: async () => {
        const projects = directory.forAgency(scope);
        for (const projectId of projectIds) await projects.require(projectId);
        return run();
      },
      catch: toOrpcError,
    });

  return {
    list: (
      scope: TreasuryScope,
      input: {
        projectId?: string;
        tokenId?: string;
        engagementId?: string;
        cursor?: string;
        limit: number;
      },
    ) =>
      Effect.gen(function* () {
        const projects = directory.forAgency(scope);
        let projectIds = input.projectId
          ? [(yield* Effect.promise(() => projects.require(input.projectId!))).id]
          : (yield* Effect.promise(() => projects.list())).map((p) => p.id);
        if (input.engagementId) {
          const shared = new Set(
            yield* Effect.tryPromise({
              try: () => engagementProjectIds(scope, input.engagementId!),
              catch: toOrpcError,
            }),
          );
          projectIds = projectIds.filter((id) => shared.has(id));
        }
        return yield* Effect.promise(() =>
          listBudgets(db, {
            projectIds,
            tokenId: input.tokenId,
            engagementId: input.engagementId,
            cursor: input.cursor,
            limit: input.limit,
          }),
        );
      }),

    create: (
      scope: TreasuryScope,
      input: {
        projectId: string;
        tokenId: string;
        amount: string;
        note?: string;
        effectiveOn?: string;
        agreementId?: string;
      },
    ) =>
      inAgency(scope, [input.projectId], async () => {
        const agreement = await resolveAgreement(db, scope.organizationId, input);
        return {
          budget: await createBudget(db, {
            ...input,
            note: input.note ?? null,
            effectiveOn: input.effectiveOn ?? agreement?.startDate ?? null,
            agreementId: agreement?.id ?? null,
            actorAccountId: scope.actorId,
            fundingDaoAccountId: scope.agencyDao,
          }),
        };
      }),

    deallocate: (
      scope: TreasuryScope,
      input: {
        projectId: string;
        tokenId: string;
        amount: string;
        note?: string;
        effectiveOn?: string;
        agreementId?: string;
      },
    ) =>
      inAgency(scope, [input.projectId], async () => {
        const agreement = await resolveAgreement(db, scope.organizationId, input);
        return {
          budget: await deallocateBudget(db, {
            ...input,
            note: input.note ?? null,
            effectiveOn: input.effectiveOn ?? agreement?.startDate ?? null,
            agreementId: agreement?.id ?? null,
            actorAccountId: scope.actorId,
            fundingDaoAccountId: scope.agencyDao,
          }),
        };
      }),

    transfer: (
      scope: TreasuryScope,
      input: {
        fromProjectId: string;
        toProjectId: string;
        tokenId: string;
        amount: string;
        note?: string;
        effectiveOn?: string;
      },
    ) =>
      inAgency(scope, [input.fromProjectId, input.toProjectId], () =>
        transferBudget(db, {
          ...input,
          note: input.note ?? null,
          actorAccountId: scope.actorId,
          fundingDaoAccountId: scope.agencyDao,
        }),
      ),

    update: (
      scope: TreasuryScope,
      input: {
        id: string;
        amount?: string;
        note?: string | null;
        effectiveOn?: string | null;
        agreementId?: string | null;
      },
    ) =>
      Effect.tryPromise({
        try: async () => {
          const entry = await entryInAgency(scope, input.id);
          if (input.agreementId) {
            await resolveAgreement(db, scope.organizationId, {
              ...entry,
              agreementId: input.agreementId,
            });
          }
          return { budget: await editBudget(db, { ...input, actorAccountId: scope.actorId }) };
        },
        catch: toOrpcError,
      }),

    remove: (scope: TreasuryScope, input: { id: string }) =>
      Effect.tryPromise({
        try: async () => {
          await entryInAgency(scope, input.id);
          return deleteBudget(db, { id: input.id, actorAccountId: scope.actorId });
        },
        catch: toOrpcError,
      }),

    listDeleted: (scope: TreasuryScope, input: { projectId?: string; limit: number }) =>
      Effect.gen(function* () {
        const projects = directory.forAgency(scope);
        const projectIds = input.projectId
          ? [(yield* Effect.promise(() => projects.require(input.projectId!))).id]
          : (yield* Effect.promise(() => projects.list())).map((p) => p.id);
        return {
          data: yield* Effect.promise(() =>
            listDeletedBudgets(db, { projectIds, limit: input.limit }),
          ),
        };
      }),
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
