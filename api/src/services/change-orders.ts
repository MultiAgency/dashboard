import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  type AllocationLine,
  type AllocationPlan,
  allocationLineApplications,
  allocationPeriods,
  allocationPlans,
  budgets,
  type ChangeOrder,
  changeOrders,
  type Engagement,
  engagementProjects,
  engagements as engagementsTable,
} from "../db/schema";
import {
  type AgencyScope,
  hasAgencyDao,
  type OrgScope,
  sharedViewScope,
} from "../lib/agency-scope";
import type { OrganizationAccess } from "../lib/organization-access";
import { createBudget } from "./budgets";
import type { EngagementRole, EngagementsService } from "./engagements";
import type { ProjectLedgers } from "./ledger";
import { prepaidBalance } from "./prepayments";
import type { ProjectDirectory } from "./project-directory";

export type ChangeOrderEvent = {
  type:
    | "change_order.proposed"
    | "change_order.approved"
    | "change_order.rejected"
    | "change_order.withdrawn"
    | "change_order.failed"
    | "plan.shortfall";
  engagementId: string;
  changeOrderId?: string;
  to: EngagementRole;
  message: string;
};

type Deps = {
  engagements: EngagementsService;
  directory: ProjectDirectory;
  ledgers: ProjectLedgers;
  access: Pick<OrganizationAccess, "daoOf">;
  notify: (event: ChangeOrderEvent) => Promise<void>;
  now?: () => Date;
};

const badRequest = (message: string) => new ORPCError("BAD_REQUEST", { message });
const notFound = () => new ORPCError("NOT_FOUND", { message: "Change order not found" });

function monthStart(date: Date, offset = 0): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
}

function other(side: EngagementRole): EngagementRole {
  return side === "agency" ? "client" : "agency";
}

function assertAmounts(lines: AllocationLine[], label: string, allowNegative: boolean) {
  for (const line of lines) {
    if (!/^-?\d+$/.test(line.amount) || BigInt(line.amount) === 0n) {
      throw badRequest(
        `${label} amounts must be non-zero whole numbers in the token's smallest unit`,
      );
    }
    if (!allowNegative && BigInt(line.amount) < 0n) {
      throw badRequest(`${label} amounts must be positive`);
    }
  }
}

export function createChangeOrdersService(db: Database, deps: Deps) {
  const now = deps.now ?? (() => new Date());

  const sideOf = (scope: OrgScope, engagement: Engagement): EngagementRole =>
    engagement.agencyOrganizationId === scope.organizationId ? "agency" : "client";

  const notify = (event: ChangeOrderEvent) =>
    deps.notify(event).catch((error: unknown) => {
      console.warn("[API] change order notification failed:", (error as Error)?.message ?? error);
    });

  const agencyDaoOf = async (engagement: Engagement) => {
    const dao = await deps.access.daoOf(engagement.agencyOrganizationId);
    if (!dao) throw badRequest("The Agency has no treasury (Agency DAO) connected.");
    return dao;
  };

  const loadChangeOrder = async (id: string) => {
    const [row] = await db.select().from(changeOrders).where(eq(changeOrders.id, id)).limit(1);
    if (!row) throw notFound();
    return row;
  };

  const partyOf = (scope: OrgScope, changeOrder: ChangeOrder) =>
    Effect.mapError(deps.engagements.asParty(scope, changeOrder.engagementId), notFound);

  const setStatus = async (id: string, patch: Partial<ChangeOrder>) => {
    const [row] = await db
      .update(changeOrders)
      .set({ ...patch, updatedAt: now() })
      .where(eq(changeOrders.id, id))
      .returning();
    return row as ChangeOrder;
  };

  const viewerFor = async (
    scope: OrgScope,
    engagement: Engagement,
    agencyDao: string,
  ): Promise<AgencyScope> => {
    if (scope.organizationId === engagement.agencyOrganizationId && hasAgencyDao(scope)) {
      return scope;
    }
    return sharedViewScope(scope, engagement.agencyOrganizationId, agencyDao) as AgencyScope;
  };

  async function checkPullBacks(
    viewer: AgencyScope,
    engagementId: string,
    moves: AllocationLine[],
  ) {
    const pullBacks = moves.filter((m) => BigInt(m.amount) < 0n);
    if (pullBacks.length === 0) return;
    const projectIds = [...new Set(pullBacks.map((m) => m.projectId))];
    const ledger = await deps.ledgers.load(viewer, projectIds);
    for (const move of pullBacks) {
      const wanted = -BigInt(move.amount);
      const remaining = BigInt(
        ledger.rollupsFor(move.projectId).find((r) => r.tokenId === move.tokenId)?.remaining ?? "0",
      );
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${budgets.amount}::numeric), 0)::text` })
        .from(budgets)
        .where(
          and(
            eq(budgets.engagementId, engagementId),
            eq(budgets.projectId, move.projectId),
            eq(budgets.tokenId, move.tokenId),
          ),
        );
      if (wanted > BigInt(row?.total ?? "0")) {
        throw badRequest(`Cannot pull back more than this Client put into ${move.projectId}.`);
      }
      if (wanted > remaining) {
        throw badRequest(
          `Cannot pull back money already Allocated, Committed or Paid on ${move.projectId}.`,
        );
      }
    }
  }

  async function applyMoves(
    viewer: AgencyScope,
    engagement: Engagement,
    moves: AllocationLine[],
    actorId: string,
    note: string,
  ) {
    await checkPullBacks(viewer, engagement.id, moves);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM ${engagementsTable} WHERE id = ${engagement.id} FOR UPDATE`,
      );
      const balance = new Map(
        (await prepaidBalance(tx as unknown as Database, engagement.id)).map((b) => [
          b.tokenId,
          BigInt(b.amount),
        ]),
      );
      const net = new Map<string, bigint>();
      for (const move of moves) {
        net.set(move.tokenId, (net.get(move.tokenId) ?? 0n) + BigInt(move.amount));
      }
      for (const [tokenId, amount] of net) {
        if (amount > (balance.get(tokenId) ?? 0n)) {
          throw badRequest(`This would put in more ${tokenId} than the Prepaid balance.`);
        }
      }
      for (const move of moves) {
        await createBudget(tx as unknown as Database, {
          projectId: move.projectId,
          tokenId: move.tokenId,
          amount: move.amount,
          note,
          actorAccountId: actorId,
          daoAccountId: viewer.agencyDao,
          engagementId: engagement.id,
        });
      }
    });
  }

  const currentPlan = async (engagementId: string, onOrBefore?: string) => {
    const [row] = await db
      .select()
      .from(allocationPlans)
      .where(
        and(
          eq(allocationPlans.engagementId, engagementId),
          onOrBefore ? lte(allocationPlans.effectiveFrom, onOrBefore) : undefined,
        ),
      )
      .orderBy(desc(allocationPlans.effectiveFrom), desc(allocationPlans.createdAt))
      .limit(1);
    return row ?? null;
  };

  async function planForPeriod(engagementId: string, periodStart: string) {
    const [assigned] = await db
      .select({ plan: allocationPlans })
      .from(allocationPeriods)
      .innerJoin(allocationPlans, eq(allocationPlans.id, allocationPeriods.planId))
      .where(
        and(
          eq(allocationPeriods.engagementId, engagementId),
          eq(allocationPeriods.periodStart, periodStart),
        ),
      )
      .limit(1);
    if (assigned) return assigned.plan;
    const plan = await currentPlan(engagementId, periodStart);
    if (!plan) return null;
    await db
      .insert(allocationPeriods)
      .values({ engagementId, periodStart, planId: plan.id })
      .onConflictDoNothing();
    return plan;
  }

  async function applyPlanLines(scope: AgencyScope, plan: AllocationPlan, periodStart: string) {
    const applied = new Set(
      (
        await db
          .select({ lineIndex: allocationLineApplications.lineIndex })
          .from(allocationLineApplications)
          .where(
            and(
              eq(allocationLineApplications.engagementId, plan.engagementId),
              eq(allocationLineApplications.periodStart, periodStart),
              eq(allocationLineApplications.planId, plan.id),
            ),
          )
      ).map((r) => r.lineIndex),
    );
    const shortfall: AllocationLine[] = [];
    for (const [index, line] of plan.lines.entries()) {
      if (applied.has(index)) continue;
      const fitted = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM ${engagementsTable} WHERE id = ${plan.engagementId} FOR UPDATE`,
        );
        const balance = (await prepaidBalance(tx as unknown as Database, plan.engagementId)).find(
          (b) => b.tokenId === line.tokenId,
        );
        if (BigInt(line.amount) > BigInt(balance?.amount ?? "0")) return false;
        const budget = await createBudget(tx as unknown as Database, {
          projectId: line.projectId,
          tokenId: line.tokenId,
          amount: line.amount,
          note: `Allocation plan · period ${periodStart}`,
          actorAccountId: scope.actorId,
          daoAccountId: scope.agencyDao,
          engagementId: plan.engagementId,
        });
        await tx.insert(allocationLineApplications).values({
          engagementId: plan.engagementId,
          periodStart,
          planId: plan.id,
          lineIndex: index,
          budgetId: budget.id,
        });
        return true;
      });
      if (!fitted) shortfall.push(line);
    }
    return shortfall;
  }

  async function applyPendingMoves(
    scope: AgencyScope,
    engagement: Engagement,
    periodStart: string,
  ) {
    const pending = await db
      .select()
      .from(changeOrders)
      .where(
        and(
          eq(changeOrders.engagementId, engagement.id),
          eq(changeOrders.status, "approved"),
          isNull(changeOrders.appliedAt),
          lte(changeOrders.effectiveFrom, periodStart),
        ),
      )
      .orderBy(changeOrders.decidedAt);
    for (const order of pending) {
      try {
        await applyMoves(scope, engagement, order.moves, scope.actorId, `Change order ${order.id}`);
        await setStatus(order.id, { appliedAt: now() });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await setStatus(order.id, { status: "failed", failureReason: reason });
        for (const to of ["agency", "client"] as const) {
          await notify({
            type: "change_order.failed",
            engagementId: engagement.id,
            changeOrderId: order.id,
            to,
            message: `A Change order could not be applied: ${reason}`,
          });
        }
      }
    }
  }

  const requireSharedProjects = async (engagementId: string, lines: AllocationLine[]) => {
    if (lines.length === 0) return;
    const shared = new Set(
      (
        await db
          .select({ projectId: engagementProjects.projectId })
          .from(engagementProjects)
          .where(
            and(
              eq(engagementProjects.engagementId, engagementId),
              inArray(
                engagementProjects.projectId,
                lines.map((l) => l.projectId),
              ),
            ),
          )
      ).map((r) => r.projectId),
    );
    for (const line of lines) {
      if (!shared.has(line.projectId)) {
        throw badRequest(`Project ${line.projectId} is not shared through this Engagement.`);
      }
    }
  };

  return {
    list: (scope: OrgScope, engagementId: string) =>
      Effect.gen(function* () {
        yield* deps.engagements.asParty(scope, engagementId);
        const data = yield* Effect.promise(() =>
          db
            .select()
            .from(changeOrders)
            .where(eq(changeOrders.engagementId, engagementId))
            .orderBy(desc(changeOrders.createdAt)),
        );
        return { data };
      }),

    plan: (scope: OrgScope, engagementId: string) =>
      Effect.gen(function* () {
        yield* deps.engagements.asParty(scope, engagementId);
        const plan = yield* Effect.promise(() => currentPlan(engagementId));
        return plan ? { id: plan.id, effectiveFrom: plan.effectiveFrom, lines: plan.lines } : null;
      }),

    propose: (
      scope: OrgScope,
      input: {
        engagementId: string;
        moves?: AllocationLine[];
        plan?: AllocationLine[];
        effective?: "next_period" | "now";
        note?: string;
      },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* deps.engagements.asParty(scope, input.engagementId);
        const moves = input.moves ?? [];
        const plan = input.plan ?? null;
        yield* Effect.promise(async () => {
          if (engagement.status !== "active") {
            throw badRequest("Change orders need an active Engagement.");
          }
          if (moves.length === 0 && plan === null) {
            throw badRequest("A Change order needs moves or a new Allocation plan.");
          }
          assertAmounts(moves, "Move", true);
          assertAmounts(plan ?? [], "Plan", false);
          await requireSharedProjects(engagement.id, [...moves, ...(plan ?? [])]);
          await agencyDaoOf(engagement);
        });
        const side = sideOf(scope, engagement);
        const [row] = yield* Effect.promise(() =>
          db
            .insert(changeOrders)
            .values({
              id: crypto.randomUUID(),
              engagementId: engagement.id,
              proposedBy: side,
              proposedByActor: scope.actorId,
              status: "proposed",
              effective: input.effective ?? "next_period",
              note: input.note?.trim() || null,
              moves,
              plan,
            })
            .returning(),
        );
        yield* Effect.promise(() =>
          notify({
            type: "change_order.proposed",
            engagementId: engagement.id,
            changeOrderId: row!.id,
            to: other(side),
            message: "A Change order is waiting for your approval.",
          }),
        );
        return row as ChangeOrder;
      }),

    approve: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const order = yield* Effect.promise(() => loadChangeOrder(id));
        const engagement = yield* partyOf(scope, order);
        return yield* Effect.promise(async () => {
          if (sideOf(scope, engagement) === order.proposedBy) {
            throw new ORPCError("FORBIDDEN", {
              message: "The other side of the Engagement approves this Change order.",
            });
          }
          if (order.status !== "proposed")
            throw badRequest("This Change order was already decided.");
          if (engagement.status !== "active") {
            throw badRequest("Change orders need an active Engagement.");
          }
          const immediate = order.effective === "now";
          const effectiveFrom = monthStart(now(), immediate ? 0 : 1);
          const agencyDao = await agencyDaoOf(engagement);
          if (immediate && order.moves.length > 0) {
            const viewer = await viewerFor(scope, engagement, agencyDao);
            await applyMoves(
              viewer,
              engagement,
              order.moves,
              scope.actorId,
              `Change order ${order.id}`,
            );
          }
          if (order.plan) {
            await db.insert(allocationPlans).values({
              id: crypto.randomUUID(),
              engagementId: engagement.id,
              changeOrderId: order.id,
              effectiveFrom,
              lines: order.plan,
            });
          }
          const updated = await setStatus(order.id, {
            status: "approved",
            decidedByActor: scope.actorId,
            decidedAt: now(),
            effectiveFrom,
            appliedAt: immediate || order.moves.length === 0 ? now() : null,
          });
          await notify({
            type: "change_order.approved",
            engagementId: engagement.id,
            changeOrderId: order.id,
            to: order.proposedBy,
            message: "Your Change order was approved.",
          });
          return updated;
        });
      }),

    reject: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const order = yield* Effect.promise(() => loadChangeOrder(id));
        const engagement = yield* partyOf(scope, order);
        return yield* Effect.promise(async () => {
          if (sideOf(scope, engagement) === order.proposedBy) {
            throw new ORPCError("FORBIDDEN", {
              message: "The other side of the Engagement decides this Change order.",
            });
          }
          if (order.status !== "proposed")
            throw badRequest("This Change order was already decided.");
          const updated = await setStatus(order.id, {
            status: "rejected",
            decidedByActor: scope.actorId,
            decidedAt: now(),
          });
          await notify({
            type: "change_order.rejected",
            engagementId: engagement.id,
            changeOrderId: order.id,
            to: order.proposedBy,
            message: "Your Change order was rejected.",
          });
          return updated;
        });
      }),

    withdraw: (scope: OrgScope, id: string) =>
      Effect.gen(function* () {
        const order = yield* Effect.promise(() => loadChangeOrder(id));
        const engagement = yield* partyOf(scope, order);
        return yield* Effect.promise(async () => {
          if (sideOf(scope, engagement) !== order.proposedBy) {
            throw new ORPCError("FORBIDDEN", {
              message: "Only the side that proposed a Change order can withdraw it.",
            });
          }
          if (order.status !== "proposed")
            throw badRequest("This Change order was already decided.");
          const updated = await setStatus(order.id, { status: "withdrawn" });
          await notify({
            type: "change_order.withdrawn",
            engagementId: engagement.id,
            changeOrderId: order.id,
            to: other(order.proposedBy),
            message: "A Change order was withdrawn.",
          });
          return updated;
        });
      }),

    applyPeriod: async (scope: AgencyScope, engagementId: string, periodStart: string) => {
      const [engagement] = await db
        .select()
        .from(engagementsTable)
        .where(eq(engagementsTable.id, engagementId))
        .limit(1);
      if (!engagement) return { shortfall: [] as AllocationLine[] };
      const plan = await planForPeriod(engagementId, periodStart);
      const shortfall = plan ? await applyPlanLines(scope, plan, periodStart) : [];
      await applyPendingMoves(scope, engagement, periodStart);
      if (shortfall.length > 0) {
        await notify({
          type: "plan.shortfall",
          engagementId,
          to: "agency",
          message: `The Prepaid balance did not cover ${shortfall.length} Allocation plan line(s) for ${periodStart}.`,
        });
      }
      return { shortfall };
    },
  };
}

export type ChangeOrdersService = ReturnType<typeof createChangeOrdersService>;
