import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { type Budget, budgets, engagementProjects, engagements } from "../db/schema";
import type { TreasuryScope } from "./organization-access";
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
  | "engagementId"
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
  engagementId?: string | null;
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
      engagementId: input.engagementId ?? null,
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

const toOrpcError = (err: unknown) =>
  err instanceof ORPCError
    ? err
    : err instanceof BudgetInsufficientError
      ? new ORPCError("BAD_REQUEST", { message: err.message })
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

  const inAgency = <A>(
    scope: TreasuryScope,
    refs: { projectIds: string[]; engagementId?: string },
    run: () => Promise<A>,
  ) =>
    Effect.tryPromise({
      try: async () => {
        if (refs.engagementId) {
          const shared = new Set(await engagementProjectIds(scope, refs.engagementId));
          if (refs.projectIds.some((id) => !shared.has(id))) {
            throw new ORPCError("BAD_REQUEST", {
              message: "The Project is not shared through this Engagement",
            });
          }
        }
        const projects = directory.forAgency(scope);
        for (const projectId of refs.projectIds) await projects.require(projectId);
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
        engagementId?: string;
      },
    ) =>
      inAgency(
        scope,
        { projectIds: [input.projectId], engagementId: input.engagementId },
        async () => ({
          budget: await createBudget(db, {
            ...input,
            note: input.note ?? null,
            engagementId: input.engagementId ?? null,
            actorAccountId: scope.actorId,
          }),
        }),
      ),

    deallocate: (
      scope: TreasuryScope,
      input: {
        projectId: string;
        tokenId: string;
        amount: string;
        note?: string;
        engagementId?: string;
      },
    ) =>
      inAgency(
        scope,
        { projectIds: [input.projectId], engagementId: input.engagementId },
        async () => ({
          budget: await deallocateBudget(db, {
            ...input,
            note: input.note ?? null,
            engagementId: input.engagementId ?? null,
            actorAccountId: scope.actorId,
          }),
        }),
      ),

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
      inAgency(scope, { projectIds: [input.fromProjectId, input.toProjectId] }, () =>
        transferBudget(db, { ...input, note: input.note ?? null, actorAccountId: scope.actorId }),
      ),
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
