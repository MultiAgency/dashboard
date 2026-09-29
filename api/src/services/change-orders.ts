import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  type ChangeOrderItemRow,
  type ChangeOrderRow,
  changeOrderItems,
  changeOrders,
  type EngagementRow,
  engagementProjects,
  engagements,
} from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import {
  appliedPeriods,
  applyChangeOrder,
  currentPlanLines,
  itemsOf,
  nextPeriod,
  type PlanApplication,
  parseShortfall,
  type ShortfallLine,
} from "./allocation-plan";
import { prefetchEngagementStatuses } from "./budgets";
import type { EngagementSide } from "./engagements";
import type { BillingStatuses, ChainStatusFetcher } from "./ledger";
import type { NotificationKind, NotificationsService } from "./notifications";
import { type OrganizationScope, ROLE_MATRIX, SHARED_STATUSES } from "./organization-access";
import { lockEngagement } from "./prepaid-balance";
import { baseUnitsToDisplay } from "./tokens";

export type ChangeOrderItemKind = ChangeOrderItemRow["kind"];

export type ChangeOrderItemInput = {
  projectId: string | null;
  tokenId: string;
  kind: ChangeOrderItemKind;
  amount: string;
};

export type ProposeChangeOrderInput = {
  engagementId: string;
  effective: ChangeOrderRow["effective"];
  note?: string | null;
  items: ChangeOrderItemInput[];
};

export type ChangeOrderView = {
  id: string;
  engagementId: string;
  proposedBy: { side: EngagementSide; organizationId: string; userId: string };
  status: ChangeOrderRow["status"];
  effective: ChangeOrderRow["effective"];
  effectivePeriod: string | null;
  note: string | null;
  items: ChangeOrderItemInput[];
  decidedByUserId: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  canDecide: boolean;
  canWithdraw: boolean;
};

export type AllocationPlanView = {
  engagementId: string;
  nextPeriod: string;
  lines: { projectId: string; tokenId: string; amount: string; effectiveFrom: string }[];
  applications: { period: string; appliedAt: Date; shortfall: ShortfallLine[] }[];
};

const notFound = () => new ORPCError("NOT_FOUND", { message: "Change order not found" });
const engagementNotFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });
const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });
const forbidden = (message: string) => new ORPCError("FORBIDDEN", { message });

const SIGNED_AMOUNT = /^-?[1-9]\d*$/;
const PENDING_STATUSES: ChangeOrderRow["status"][] = ["proposed", "approved"];

function sideOf(engagement: EngagementRow, organizationId: string): EngagementSide | null {
  if (engagement.agencyOrganizationId === organizationId) return "agency";
  if (engagement.clientOrganizationId === organizationId) return "client";
  return null;
}

function organizationOf(engagement: EngagementRow, side: EngagementSide): string {
  return side === "agency" ? engagement.agencyOrganizationId : engagement.clientOrganizationId;
}

function otherSide(side: EngagementSide): EngagementSide {
  return side === "agency" ? "client" : "agency";
}

function proposerSide(engagement: EngagementRow, changeOrder: ChangeOrderRow): EngagementSide {
  return changeOrder.proposedByOrganizationId === engagement.agencyOrganizationId
    ? "agency"
    : "client";
}

function linkFor(engagement: EngagementRow, side: EngagementSide): string {
  return side === "agency"
    ? `/admin/engagements/${engagement.id}?tab=plan`
    : `/client/${engagement.id}/plan`;
}

function balancedItems(items: ChangeOrderItemInput[]): ChangeOrderItemInput[] {
  const planChanges = items.filter((i) => i.kind === "plan_change");
  const moves = items.filter((i) => i.kind === "one_off_move" && i.projectId !== null);
  const givenBalance = new Map<string, bigint>();
  for (const item of items) {
    if (item.kind === "one_off_move" && item.projectId === null) {
      givenBalance.set(item.tokenId, (givenBalance.get(item.tokenId) ?? 0n) + BigInt(item.amount));
    }
  }
  const net = new Map<string, bigint>();
  for (const move of moves) {
    net.set(move.tokenId, (net.get(move.tokenId) ?? 0n) + BigInt(move.amount));
  }
  for (const tokenId of new Set([...net.keys(), ...givenBalance.keys()])) {
    const expected = -(net.get(tokenId) ?? 0n);
    const given = givenBalance.get(tokenId);
    if (given !== undefined && given !== expected) {
      throw badRequest(
        "UNBALANCED",
        `The Prepaid balance item in ${tokenId} must be ${expected.toString()}, the opposite of what moves into Projects.`,
      );
    }
  }
  const balance = [...net.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([tokenId, amount]) => ({
      projectId: null,
      tokenId,
      kind: "one_off_move" as const,
      amount: (-amount).toString(),
    }));
  return [...planChanges, ...moves, ...balance];
}

export function createChangeOrdersService(deps: {
  db: Database;
  organizations: OrganizationDirectory;
  notifications: NotificationsService;
  chainStatus?: ChainStatusFetcher;
  now?: () => Date;
}) {
  const { db, organizations, notifications } = deps;
  const now = deps.now ?? (() => new Date());

  const userIdOf = (scope: OrganizationScope) => scope.pluginContext.userId ?? scope.actorId;
  const isManager = (scope: OrganizationScope) =>
    scope.role !== null && (ROLE_MATRIX.manage as readonly string[]).includes(scope.role);

  function requireManager(scope: OrganizationScope) {
    if (!isManager(scope)) {
      throw forbidden("Only owners and admins can propose or decide Change orders.");
    }
  }

  async function readable(scope: OrganizationScope, engagementId: string) {
    const [row] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.id, engagementId))
      .limit(1);
    const side = row ? sideOf(row, scope.organizationId) : null;
    if (!row || !side) throw engagementNotFound();
    if (side === "client" && !SHARED_STATUSES.includes(row.status)) throw engagementNotFound();
    return { engagement: row, side };
  }

  async function readableChangeOrder(scope: OrganizationScope, id: string) {
    const [changeOrder] = await db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.id, id))
      .limit(1);
    if (!changeOrder) throw notFound();
    const { engagement, side } = await readable(scope, changeOrder.engagementId).catch(() => {
      throw notFound();
    });
    return { changeOrder, engagement, side };
  }

  function view(
    scope: OrganizationScope,
    engagement: EngagementRow,
    changeOrder: ChangeOrderRow,
    items: ChangeOrderItemRow[],
  ): ChangeOrderView {
    const proposer = proposerSide(engagement, changeOrder);
    const viewer = sideOf(engagement, scope.organizationId);
    const open =
      changeOrder.status === "proposed" && engagement.status === "active" && isManager(scope);
    return {
      id: changeOrder.id,
      engagementId: changeOrder.engagementId,
      proposedBy: {
        side: proposer,
        organizationId: changeOrder.proposedByOrganizationId,
        userId: changeOrder.proposedByUserId,
      },
      status: changeOrder.status,
      effective: changeOrder.effective,
      effectivePeriod: changeOrder.effectivePeriod,
      note: changeOrder.note,
      items: items.map((item) => ({
        projectId: item.projectId,
        tokenId: item.tokenId,
        kind: item.kind,
        amount: item.amount,
      })),
      decidedByUserId: changeOrder.decidedByUserId,
      decidedAt: changeOrder.decidedAt,
      appliedAt: changeOrder.appliedAt,
      failureReason: changeOrder.failureReason,
      createdAt: changeOrder.createdAt,
      updatedAt: changeOrder.updatedAt,
      canDecide: open && viewer !== proposer,
      canWithdraw: open && viewer === proposer,
    };
  }

  async function views(
    scope: OrganizationScope,
    engagementsById: Map<string, EngagementRow>,
    rows: ChangeOrderRow[],
  ): Promise<ChangeOrderView[]> {
    const items =
      rows.length === 0
        ? []
        : await db
            .select()
            .from(changeOrderItems)
            .where(
              inArray(
                changeOrderItems.changeOrderId,
                rows.map((r) => r.id),
              ),
            );
    return rows.map((row) =>
      view(
        scope,
        engagementsById.get(row.engagementId)!,
        row,
        items
          .filter((item) => item.changeOrderId === row.id)
          .sort((a, b) => a.position - b.position),
      ),
    );
  }

  async function tell(
    engagement: EngagementRow,
    to: EngagementSide,
    kind: NotificationKind,
    extra: Record<string, string>,
    excludeUserId: string | null,
  ) {
    try {
      const [agency, client] = await Promise.all([
        organizations.get(engagement.agencyOrganizationId),
        organizations.get(engagement.clientOrganizationId),
      ]);
      await notifications.notify({
        organizationId: organizationOf(engagement, to),
        kind,
        payload: {
          agencyName: agency?.name ?? engagement.agencyOrganizationId,
          clientName: client?.name ?? engagement.clientOrganizationId,
          engagementId: engagement.id,
          ...extra,
        },
        link: linkFor(engagement, to),
        excludeUserId,
      });
    } catch (err) {
      console.warn("[API] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  async function partyName(engagement: EngagementRow, side: EngagementSide) {
    const id = organizationOf(engagement, side);
    return (await organizations.get(id))?.name ?? id;
  }

  async function tellOutcome(
    scope: OrganizationScope,
    engagement: EngagementRow,
    changeOrder: ChangeOrderRow,
    kind: NotificationKind,
  ) {
    const proposer = proposerSide(engagement, changeOrder);
    const decider = otherSide(proposer);
    await tell(
      engagement,
      proposer,
      kind,
      {
        deciderName: await partyName(engagement, decider),
        changeOrderId: changeOrder.id,
        reason: changeOrder.failureReason ?? "",
      },
      userIdOf(scope),
    );
  }

  async function requireSharedProjects(engagementId: string, items: ChangeOrderItemInput[]) {
    const rows = await db
      .select({ projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .where(eq(engagementProjects.engagementId, engagementId));
    const shared = new Set(rows.map((r) => r.projectId));
    const outside = items.find((item) => item.projectId !== null && !shared.has(item.projectId));
    if (outside) {
      throw badRequest("NOT_SHARED", "The Project is not shared through this Engagement.");
    }
  }

  function requireValidItems(items: ChangeOrderItemInput[]) {
    if (items.length === 0) {
      throw badRequest("NO_ITEMS", "A Change order needs at least one item.");
    }
    for (const item of items) {
      if (!SIGNED_AMOUNT.test(item.amount)) {
        throw badRequest(
          "INVALID_AMOUNT",
          "An item amount is a non-zero whole number in the token's smallest unit.",
        );
      }
      if (item.kind === "plan_change" && item.projectId === null) {
        throw badRequest("PLAN_NEEDS_PROJECT", "A plan change is always for a Project.");
      }
    }
  }

  async function decide(
    scope: OrganizationScope,
    id: string,
    run: (
      tx: Database,
      engagement: EngagementRow,
      changeOrder: ChangeOrderRow,
      statuses: BillingStatuses,
    ) => Promise<ChangeOrderRow>,
    options: { applies: boolean },
  ) {
    requireManager(scope);
    const { changeOrder: seen } = await readableChangeOrder(scope, id);
    const statuses: BillingStatuses = options.applies
      ? await prefetchEngagementStatuses(
          db,
          seen.engagementId,
          await itemsOf(db, seen.id),
          deps.chainStatus,
        )
      : new Map();
    return db.transaction(async (tx) => {
      const engagement = await lockEngagement(tx as Database, seen.engagementId);
      const [changeOrder] = await tx
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, id))
        .for("update");
      if (!engagement || !changeOrder) throw notFound();
      if (changeOrder.status !== "proposed") {
        throw badRequest("NOT_PROPOSED", "This Change order was already decided or withdrawn.");
      }
      if (engagement.status !== "active") {
        throw badRequest(
          "NOT_ACTIVE",
          "Change orders can only be decided on an active Engagement.",
        );
      }
      if (changeOrder.proposedByOrganizationId === scope.organizationId) {
        throw forbidden("A Change order is decided by the side that did not propose it.");
      }
      return {
        engagement,
        changeOrder: await run(tx as Database, engagement, changeOrder, statuses),
      };
    });
  }

  async function finish(
    scope: OrganizationScope,
    engagement: EngagementRow,
    changeOrder: ChangeOrderRow,
  ) {
    return view(scope, engagement, changeOrder, await itemsOf(db, changeOrder.id));
  }

  return {
    list: async (scope: OrganizationScope, input: { engagementId: string }) => {
      const { engagement } = await readable(scope, input.engagementId);
      const rows = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.engagementId, engagement.id))
        .orderBy(desc(changeOrders.createdAt), desc(changeOrders.id));
      return { data: await views(scope, new Map([[engagement.id, engagement]]), rows) };
    },

    awaiting: async (scope: OrganizationScope) => {
      const related = await db
        .select()
        .from(engagements)
        .where(
          and(
            eq(engagements.status, "active"),
            or(
              eq(engagements.agencyOrganizationId, scope.organizationId),
              eq(engagements.clientOrganizationId, scope.organizationId),
            ),
          ),
        );
      if (related.length === 0) return { data: [] };
      const rows = await db
        .select()
        .from(changeOrders)
        .where(
          and(
            inArray(
              changeOrders.engagementId,
              related.map((e) => e.id),
            ),
            eq(changeOrders.status, "proposed"),
            ne(changeOrders.proposedByOrganizationId, scope.organizationId),
          ),
        )
        .orderBy(desc(changeOrders.createdAt), desc(changeOrders.id));
      return { data: await views(scope, new Map(related.map((e) => [e.id, e])), rows) };
    },

    plan: async (
      scope: OrganizationScope,
      input: { engagementId: string },
    ): Promise<AllocationPlanView> => {
      const { engagement } = await readable(scope, input.engagementId);
      const [lines, applications, next] = await Promise.all([
        currentPlanLines(db, engagement.id),
        appliedPeriods(db, engagement.id),
        nextPeriod(db, engagement.id, now()),
      ]);
      return {
        engagementId: engagement.id,
        nextPeriod: next,
        lines: lines.map((line) => ({
          projectId: line.projectId,
          tokenId: line.tokenId,
          amount: line.amount,
          effectiveFrom: line.effectiveFrom,
        })),
        applications: applications
          .map((a) => ({
            period: a.period,
            appliedAt: a.appliedAt,
            shortfall: parseShortfall(a.shortfall),
          }))
          .reverse(),
      };
    },

    propose: async (scope: OrganizationScope, input: ProposeChangeOrderInput) => {
      requireManager(scope);
      const { engagement, side } = await readable(scope, input.engagementId);
      if (engagement.status !== "active") {
        throw badRequest(
          "NOT_ACTIVE",
          "Change orders can only be proposed on an active Engagement.",
        );
      }
      requireValidItems(input.items);
      const items = balancedItems(input.items);
      await requireSharedProjects(engagement.id, items);
      const created = now();
      const changeOrder = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(changeOrders)
          .values({
            id: crypto.randomUUID(),
            engagementId: engagement.id,
            proposedByOrganizationId: scope.organizationId,
            proposedByUserId: userIdOf(scope),
            status: "proposed",
            effective: input.effective,
            note: input.note?.trim() || null,
            createdAt: created,
            updatedAt: created,
          })
          .returning();
        await tx.insert(changeOrderItems).values(
          items.map((item, position) => ({
            id: crypto.randomUUID(),
            changeOrderId: row!.id,
            position,
            ...item,
          })),
        );
        return row!;
      });
      await tell(
        engagement,
        otherSide(side),
        "change_order_proposed",
        { proposerName: await partyName(engagement, side), changeOrderId: changeOrder.id },
        userIdOf(scope),
      );
      return finish(scope, engagement, changeOrder);
    },

    withdraw: async (scope: OrganizationScope, input: { id: string }) => {
      requireManager(scope);
      const { changeOrder, engagement, side } = await readableChangeOrder(scope, input.id);
      if (changeOrder.proposedByOrganizationId !== scope.organizationId) {
        throw forbidden("Only the side that proposed a Change order can withdraw it.");
      }
      const [withdrawn] = await db
        .update(changeOrders)
        .set({ status: "withdrawn", updatedAt: now() })
        .where(and(eq(changeOrders.id, changeOrder.id), eq(changeOrders.status, "proposed")))
        .returning();
      if (!withdrawn) {
        throw badRequest("NOT_PROPOSED", "Only a proposed Change order can be withdrawn.");
      }
      await tell(
        engagement,
        otherSide(side),
        "change_order_withdrawn",
        { proposerName: await partyName(engagement, side), changeOrderId: withdrawn.id },
        userIdOf(scope),
      );
      return finish(scope, engagement, withdrawn);
    },

    approve: async (scope: OrganizationScope, input: { id: string }) => {
      const { engagement, changeOrder } = await decide(
        scope,
        input.id,
        async (tx, engagement, changeOrder, statuses) => {
          const decidedAt = now();
          const effectivePeriod = await nextPeriod(tx, engagement.id, decidedAt);
          const [approved] = await tx
            .update(changeOrders)
            .set({
              status: "approved",
              effectivePeriod,
              decidedByUserId: userIdOf(scope),
              decidedAt,
              updatedAt: decidedAt,
            })
            .where(eq(changeOrders.id, changeOrder.id))
            .returning();
          const items = await itemsOf(tx, approved!.id);
          const waits =
            approved!.effective === "next_period" &&
            items.some((item) => item.kind === "one_off_move");
          if (waits) return approved!;
          const outcome = await applyChangeOrder(tx, engagement, approved!, {
            actorAccountId: scope.actorId,
            effectivePeriod,
            now: decidedAt,
            statuses,
          });
          return outcome.changeOrder;
        },
        { applies: true },
      );
      await tellOutcome(
        scope,
        engagement,
        changeOrder,
        changeOrder.status === "failed" ? "change_order_failed" : "change_order_approved",
      );
      return finish(scope, engagement, changeOrder);
    },

    reject: async (scope: OrganizationScope, input: { id: string }) => {
      const { engagement, changeOrder } = await decide(
        scope,
        input.id,
        async (tx, _engagement, changeOrder) => {
          const decidedAt = now();
          const [rejected] = await tx
            .update(changeOrders)
            .set({
              status: "rejected",
              decidedByUserId: userIdOf(scope),
              decidedAt,
              updatedAt: decidedAt,
            })
            .where(eq(changeOrders.id, changeOrder.id))
            .returning();
          return rejected!;
        },
        { applies: false },
      );
      await tellOutcome(scope, engagement, changeOrder, "change_order_rejected");
      return finish(scope, engagement, changeOrder);
    },

    withdrawPending: async (engagement: EngagementRow) => {
      await db
        .update(changeOrders)
        .set({ status: "withdrawn", updatedAt: now() })
        .where(
          and(
            eq(changeOrders.engagementId, engagement.id),
            inArray(changeOrders.status, PENDING_STATUSES),
          ),
        );
    },

    notifyPlanApplied: async (
      scope: OrganizationScope,
      engagement: EngagementRow,
      application: PlanApplication,
    ) => {
      for (const { changeOrder } of application.changeOrders) {
        if (changeOrder.status === "failed") {
          await tellOutcome(scope, engagement, changeOrder, "change_order_failed");
        }
      }
      if (application.shortfall.length === 0) return;
      const summary = application.shortfall
        .map((line) => baseUnitsToDisplay(line.amount, line.tokenId))
        .join(", ");
      for (const side of ["agency", "client"] as const) {
        await tell(
          engagement,
          side,
          "plan_shortfall",
          {
            period: application.period,
            count: String(application.shortfall.length),
            amounts: summary,
          },
          null,
        );
      }
    },
  };
}

export type ChangeOrdersService = ReturnType<typeof createChangeOrdersService>;
