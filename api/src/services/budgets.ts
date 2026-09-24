import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import {
  type Budget,
  budgets,
  engagementProjects,
  engagements,
  organizationDaos,
} from "../db/schema";
import {
  type BillingStatuses,
  type ChainStatusFetcher,
  prefetchBillingStatuses,
  projectSpend,
} from "./ledger";
import type { TreasuryScope } from "./organization-access";
import { lockEngagement, prepaidBalances } from "./prepaid-balance";
import type { ProjectDirectory } from "./project-directory";

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
  if (sums.own + delta < 0n) {
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
  | "createdAt"
>;

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

  const last = rows[rows.length - 1];
  return {
    data: rows,
    nextCursor: rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
  };
}

export interface CreateBudgetInput {
  projectId: string;
  tokenId: string;
  amount: string;
  note: string | null;
  actorAccountId: string;
  fundingDaoAccountId?: string | null;
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

export type ChainStatusInput = { statuses?: BillingStatuses; chainStatus?: ChainStatusFetcher };

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
  for (const { projectId, tokenId, delta } of byProjectToken.values()) {
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
  } & ChainStatusInput,
): Promise<Budget[]> {
  if (input.entries.length === 0) return [];
  const statuses =
    input.statuses ??
    (await prefetchEngagementStatuses(db, input.engagementId, input.entries, input.chainStatus));
  return db.transaction(async (tx) => {
    const fundingDaoAccountId = await checkEngagementEntries(
      tx as Database,
      input.engagementId,
      input.entries,
      statuses,
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

const toOrpcError = (err: unknown) =>
  err instanceof ORPCError
    ? err
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
      input: { projectId: string; tokenId: string; amount: string; note?: string },
    ) =>
      inAgency(scope, [input.projectId], async () => ({
        budget: await createBudget(db, {
          ...input,
          note: input.note ?? null,
          actorAccountId: scope.actorId,
          fundingDaoAccountId: scope.agencyDao,
        }),
      })),

    deallocate: (
      scope: TreasuryScope,
      input: { projectId: string; tokenId: string; amount: string; note?: string },
    ) =>
      inAgency(scope, [input.projectId], async () => ({
        budget: await deallocateBudget(db, {
          ...input,
          note: input.note ?? null,
          actorAccountId: scope.actorId,
          fundingDaoAccountId: scope.agencyDao,
        }),
      })),

    transfer: (
      scope: TreasuryScope,
      input: {
        fromProjectId: string;
        toProjectId: string;
        tokenId: string;
        amount: string;
        note?: string;
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
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
