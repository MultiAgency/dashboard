import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { type Budget, billings, budgets } from "../db/schema";
import { getListingForProject } from "./listings";
import { resolveActiveListing, rollupForToken } from "./rollups";
import { enrichWithChainStatus, networkOf } from "./sputnik";

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

// FOR UPDATE serializes concurrent deallocates/transfers against READ COMMITTED stale reads.
async function lockedBudgetSum(tx: Database, projectId: string, tokenId: string): Promise<bigint> {
  const rows = await tx
    .select({ amount: budgets.amount })
    .from(budgets)
    .where(and(eq(budgets.projectId, projectId), eq(budgets.tokenId, tokenId)))
    .for("update");
  return rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);
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
  | "createdAt"
>;

export interface ListBudgetsInput {
  projectIds: string[] | null;
  tokenId?: string;
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
      createdAt: budgets.createdAt,
    })
    .from(budgets)
    .where(
      and(
        input.projectIds !== null ? inArray(budgets.projectId, input.projectIds) : undefined,
        input.tokenId ? eq(budgets.tokenId, input.tokenId) : undefined,
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
}

export async function createBudget(db: Database, input: CreateBudgetInput): Promise<Budget> {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(budgets)
    .values({
      id,
      projectId: input.projectId,
      tokenId: input.tokenId,
      amount: input.amount,
      note: input.note,
      actorAccountId: input.actorAccountId,
    })
    .returning();
  if (!row) throw new Error("budgets insert returned no row");
  return row;
}

export async function deallocateBudget(db: Database, input: CreateBudgetInput): Promise<Budget> {
  const delta = -BigInt(input.amount);
  return db.transaction(async (tx) => {
    const sum = await lockedBudgetSum(tx as Database, input.projectId, input.tokenId);
    if (sum + delta < 0n) {
      throw new BudgetInsufficientError(input.projectId, input.tokenId, sum, delta);
    }
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
}

export async function transferBudget(
  db: Database,
  input: TransferBudgetInput,
): Promise<{ from: Budget; to: Budget }> {
  const transferAmount = BigInt(input.amount);
  const fromId = crypto.randomUUID();
  const toId = crypto.randomUUID();
  const now = new Date();

  return db.transaction(async (tx) => {
    const fromSum = await lockedBudgetSum(tx as Database, input.fromProjectId, input.tokenId);
    if (fromSum - transferAmount < 0n) {
      throw new BudgetInsufficientError(
        input.fromProjectId,
        input.tokenId,
        fromSum,
        -transferAmount,
      );
    }
    const inserted = await tx
      .insert(budgets)
      .values([
        {
          id: fromId,
          projectId: input.fromProjectId,
          tokenId: input.tokenId,
          amount: (-transferAmount).toString(),
          note: input.note,
          actorAccountId: input.actorAccountId,
          relatedBudgetId: toId,
          createdAt: now,
        },
        {
          id: toId,
          projectId: input.toProjectId,
          tokenId: input.tokenId,
          amount: transferAmount.toString(),
          note: input.note,
          actorAccountId: input.actorAccountId,
          relatedBudgetId: fromId,
          createdAt: now,
        },
      ])
      .returning();

    const from = inserted.find((r) => r.id === fromId);
    const to = inserted.find((r) => r.id === toId);
    if (!from || !to) throw new Error("budgets transfer insert returned incomplete rows");
    return { from, to };
  });
}

export function createBudgetsService(db: Database) {
  return {
    list: (input: ListBudgetsInput) => listBudgets(db, input),

    create: (input: CreateBudgetInput) =>
      Effect.tryPromise({
        try: () => createBudget(db, input),
        catch: (err) => err as Error,
      }),

    deallocate: (input: CreateBudgetInput) =>
      Effect.tryPromise({
        try: () => deallocateBudget(db, input),
        catch: (err) => {
          if (err instanceof BudgetInsufficientError) {
            return new ORPCError("BAD_REQUEST", { message: err.message });
          }
          return new ORPCError("INTERNAL_SERVER_ERROR", {
            message: err instanceof Error ? err.message : String(err),
          });
        },
      }),

    transfer: (input: TransferBudgetInput) =>
      Effect.tryPromise({
        try: () => transferBudget(db, input),
        catch: (err) => {
          if (err instanceof BudgetInsufficientError) {
            return new ORPCError("BAD_REQUEST", { message: err.message });
          }
          return new ORPCError("INTERNAL_SERVER_ERROR", {
            message: err instanceof Error ? err.message : String(err),
          });
        },
      }),

    computeBudget: async (projectId: string, orgId: string) => {
      const [budgetRows, billsRaw, nearnListing, internalListing] = await Promise.all([
        db
          .select({ tokenId: budgets.tokenId, amount: budgets.amount })
          .from(budgets)
          .where(eq(budgets.projectId, projectId)),
        db.select().from(billings).where(eq(billings.projectId, projectId)),
        getListingForProject(projectId, "nearn", orgId, db),
        getListingForProject(projectId, "internal", orgId, db),
      ]);
      const bills = await Promise.all(billsRaw.map((b) => enrichWithChainStatus(db, b, orgId)));
      const resolved = resolveActiveListing(nearnListing, internalListing, networkOf(orgId));
      const tokenIds = Array.from(
        new Set([
          ...budgetRows.map((b) => b.tokenId),
          ...bills.map((b) => b.tokenId),
          ...(resolved ? [resolved.tokenId] : []),
        ]),
      ).sort();
      return tokenIds.map((tokenId) => {
        const r = rollupForToken({
          tokenId,
          budgetAmounts: budgetRows
            .filter((b) => b.tokenId === tokenId)
            .map((b) => BigInt(b.amount)),
          billings: bills
            .filter((b) => b.tokenId === tokenId)
            .map((b) => ({ amount: b.amount, status: b.status })),
          listing: resolved,
        });
        return {
          tokenId,
          budget: r.budget.toString(),
          allocated: r.allocated.toString(),
          committed: r.committed.toString(),
          paid: r.paid.toString(),
          remaining: r.remaining.toString(),
        };
      });
    },
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
