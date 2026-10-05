import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  billings,
  budgets,
  type WorkOrderLineRow,
  type WorkOrderRow,
  workOrderLines,
  workOrders,
} from "../db/schema";
import type { OrganizationScope } from "./organization-access";

export type WorkOrderStatus = WorkOrderRow["status"];

export type WorkOrderWarning = "overpaid" | "overBudget" | "endingSoon" | "noAgreement";

export type WorkOrderLineInput = { projectId: string; tokenId: string; amount: string };

export type WorkOrderInput = {
  nearAccount: string;
  status: WorkOrderStatus;
  startsOn: string;
  endsOn: string;
  documentUrl?: string | null;
  lines: WorkOrderLineInput[];
};

export type WorkOrderView = {
  id: string;
  nearAccount: string;
  status: WorkOrderStatus;
  startsOn: string;
  endsOn: string;
  documentUrl: string | null;
  closedAt: string | null;
  lines: Array<{
    projectId: string;
    projectTitle: string | null;
    tokenId: string;
    amount: string;
    paid: string;
    remaining: string;
    warnings: WorkOrderWarning[];
  }>;
  warnings: WorkOrderWarning[];
};

export type UncoveredPayout = {
  billingId: string;
  projectId: string;
  projectTitle: string | null;
  nearAccount: string | null;
  tokenId: string;
  amount: string;
  recordedAt: string;
};

export type WorkOrderDeps = {
  db: Database;
  isPlatformAdmin: (scope: OrganizationScope) => boolean;
  projectsOf: (scope: OrganizationScope) => Promise<Array<{ id: string; title: string }>>;
  accountsOf: (scope: OrganizationScope, nearAccount: string) => Promise<string[]>;
  agreementOnFile: (scope: OrganizationScope) => Promise<(nearAccount: string) => boolean>;
  approved: (
    scope: OrganizationScope,
    rows: Array<{ proposalId: string; payingDaoAccountId: string | null }>,
  ) => Promise<boolean[]>;
  now?: () => Date;
};

const ENDING_SOON_DAYS = 14;
const UNCOVERED_LOOKBACK_DAYS = 180;
const ACTIVE: WorkOrderStatus[] = ["signed"];

const notFound = () => new ORPCError("NOT_FOUND", { message: "Work order not found" });
const badRequest = (message: string) => new ORPCError("BAD_REQUEST", { message });

const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export function createWorkOrdersService(deps: WorkOrderDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function requirePlatformAdmin(scope: OrganizationScope) {
    if (!deps.isPlatformAdmin(scope)) {
      throw new ORPCError("FORBIDDEN", { message: "Only a platform admin manages work orders" });
    }
  }

  async function requireOwn(scope: OrganizationScope, id: string) {
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id)).limit(1);
    if (!row || row.organizationId !== scope.organizationId) throw notFound();
    return row;
  }

  async function validate(scope: OrganizationScope, input: WorkOrderInput, id?: string) {
    if (!input.nearAccount.trim()) throw badRequest("A work order needs a contributor");
    if (!isDate(input.startsOn) || !isDate(input.endsOn)) {
      throw badRequest("Start and end must be dates (YYYY-MM-DD)");
    }
    if (input.endsOn < input.startsOn) throw badRequest("The end date is before the start date");
    if (input.lines.length === 0) throw badRequest("A work order needs at least one Project");
    const keys = new Set<string>();
    for (const line of input.lines) {
      if (!/^\d+$/.test(line.amount) || BigInt(line.amount) <= 0n) {
        throw badRequest("Each line needs a positive amount");
      }
      const key = `${line.projectId}:${line.tokenId}`;
      if (keys.has(key)) throw badRequest("A Project and token can appear only once");
      keys.add(key);
    }
    const own = new Set((await deps.projectsOf(scope)).map((p) => p.id));
    if (input.lines.some((line) => !own.has(line.projectId))) {
      throw badRequest("Every Project must belong to this Agency");
    }
    if (ACTIVE.includes(input.status)) {
      const projectIds = input.lines.map((l) => l.projectId);
      const clashing = await db
        .select({ projectId: workOrderLines.projectId })
        .from(workOrderLines)
        .innerJoin(workOrders, eq(workOrders.id, workOrderLines.workOrderId))
        .where(
          and(
            eq(workOrders.organizationId, scope.organizationId),
            eq(workOrders.nearAccount, input.nearAccount.trim()),
            inArray(workOrders.status, ACTIVE),
            inArray(workOrderLines.projectId, projectIds),
            id ? ne(workOrders.id, id) : undefined,
          ),
        )
        .limit(1);
      if (clashing.length > 0) {
        throw badRequest(
          "This contributor already has an active work order on one of these Projects",
        );
      }
    }
  }

  function closedAtFor(status: WorkOrderStatus, previous?: WorkOrderRow) {
    if (status === "completed" || status === "terminated") return previous?.closedAt ?? now();
    return null;
  }

  async function paidOn(
    scope: OrganizationScope,
    order: WorkOrderRow,
    line: WorkOrderLineRow,
    accounts: string[],
  ): Promise<bigint> {
    const rows = await db
      .select()
      .from(billings)
      .where(
        and(
          eq(billings.projectId, line.projectId),
          eq(billings.tokenId, line.tokenId),
          inArray(billings.nearAccount, accounts),
          gte(billings.createdAt, new Date(`${order.startsOn}T00:00:00Z`)),
        ),
      );
    const inWindow = rows.filter((b) => !order.closedAt || b.createdAt <= order.closedAt);
    const approved = await deps.approved(scope, inWindow);
    return inWindow.reduce((sum, b, i) => (approved[i] ? sum + BigInt(b.amount) : sum), 0n);
  }

  async function budgetTotals(projectIds: string[]) {
    const totals = new Map<string, bigint>();
    if (projectIds.length === 0) return totals;
    const rows = await db.select().from(budgets).where(inArray(budgets.projectId, projectIds));
    for (const row of rows) {
      const key = `${row.projectId}:${row.tokenId}`;
      totals.set(key, (totals.get(key) ?? 0n) + BigInt(row.amount));
    }
    return totals;
  }

  async function views(scope: OrganizationScope, orders: WorkOrderRow[]): Promise<WorkOrderView[]> {
    if (orders.length === 0) return [];
    const lines = await db
      .select()
      .from(workOrderLines)
      .where(
        inArray(
          workOrderLines.workOrderId,
          orders.map((o) => o.id),
        ),
      );
    const linesOf = Map.groupBy(lines, (l) => l.workOrderId);
    const titles = new Map((await deps.projectsOf(scope)).map((p) => [p.id, p.title]));
    const budgetsByKey = await budgetTotals([...new Set(lines.map((l) => l.projectId))]);
    const committedByKey = new Map<string, bigint>();
    for (const order of orders.filter((o) => ACTIVE.includes(o.status))) {
      for (const line of linesOf.get(order.id) ?? []) {
        const key = `${line.projectId}:${line.tokenId}`;
        committedByKey.set(key, (committedByKey.get(key) ?? 0n) + BigInt(line.amount));
      }
    }
    const hasAgreement = await deps.agreementOnFile(scope);
    const today = now().toISOString().slice(0, 10);
    const soon = new Date(now().getTime() + ENDING_SOON_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    return Promise.all(
      orders.map(async (order) => {
        const accounts = await deps.accountsOf(scope, order.nearAccount);
        const active = ACTIVE.includes(order.status);
        const lineViews = await Promise.all(
          (linesOf.get(order.id) ?? []).map(async (line) => {
            const paid = await paidOn(scope, order, line, accounts);
            const amount = BigInt(line.amount);
            const key = `${line.projectId}:${line.tokenId}`;
            const warnings: WorkOrderWarning[] = [];
            if (paid > amount) warnings.push("overpaid");
            if (active && (committedByKey.get(key) ?? 0n) > (budgetsByKey.get(key) ?? 0n)) {
              warnings.push("overBudget");
            }
            return {
              projectId: line.projectId,
              projectTitle: titles.get(line.projectId) ?? null,
              tokenId: line.tokenId,
              amount: line.amount,
              paid: paid.toString(),
              remaining: (amount > paid ? amount - paid : 0n).toString(),
              warnings,
            };
          }),
        );
        const warnings = new Set<WorkOrderWarning>(lineViews.flatMap((l) => l.warnings));
        if (active && order.endsOn >= today && order.endsOn <= soon) warnings.add("endingSoon");
        if (active && !accounts.some(hasAgreement)) warnings.add("noAgreement");
        return {
          id: order.id,
          nearAccount: order.nearAccount,
          status: order.status,
          startsOn: order.startsOn,
          endsOn: order.endsOn,
          documentUrl: order.documentUrl,
          closedAt: order.closedAt?.toISOString() ?? null,
          lines: lineViews,
          warnings: [...warnings],
        };
      }),
    );
  }

  return {
    list: async (scope: OrganizationScope) => {
      requirePlatformAdmin(scope);
      const orders = await db
        .select()
        .from(workOrders)
        .where(eq(workOrders.organizationId, scope.organizationId));
      orders.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
      return { data: await views(scope, orders) };
    },

    create: async (scope: OrganizationScope, input: WorkOrderInput) => {
      requirePlatformAdmin(scope);
      await validate(scope, input);
      const id = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(workOrders).values({
          id,
          organizationId: scope.organizationId,
          nearAccount: input.nearAccount.trim(),
          status: input.status,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          documentUrl: input.documentUrl?.trim() || null,
          closedAt: closedAtFor(input.status),
          createdBy: scope.actorId,
        });
        await tx
          .insert(workOrderLines)
          .values(input.lines.map((line) => ({ workOrderId: id, ...line })));
      });
      const [view] = await views(scope, [await requireOwn(scope, id)]);
      return { data: view! };
    },

    update: async (scope: OrganizationScope, input: WorkOrderInput & { id: string }) => {
      requirePlatformAdmin(scope);
      const previous = await requireOwn(scope, input.id);
      await validate(scope, input, input.id);
      await db.transaction(async (tx) => {
        await tx
          .update(workOrders)
          .set({
            nearAccount: input.nearAccount.trim(),
            status: input.status,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            documentUrl: input.documentUrl?.trim() || null,
            closedAt: closedAtFor(input.status, previous),
            updatedAt: now(),
          })
          .where(eq(workOrders.id, input.id));
        await tx.delete(workOrderLines).where(eq(workOrderLines.workOrderId, input.id));
        await tx
          .insert(workOrderLines)
          .values(input.lines.map((line) => ({ workOrderId: input.id, ...line })));
      });
      const [view] = await views(scope, [await requireOwn(scope, input.id)]);
      return { data: view! };
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      requirePlatformAdmin(scope);
      const row = await requireOwn(scope, input.id);
      if (row.status !== "draft") {
        throw badRequest("Only a draft can be deleted; mark it terminated instead");
      }
      await db.delete(workOrders).where(eq(workOrders.id, input.id));
      return { ok: true as const };
    },

    uncoveredPayouts: async (scope: OrganizationScope) => {
      requirePlatformAdmin(scope);
      const projects = await deps.projectsOf(scope);
      if (projects.length === 0) return { data: [] };
      const titles = new Map(projects.map((p) => [p.id, p.title]));
      const since = new Date(now().getTime() - UNCOVERED_LOOKBACK_DAYS * 86_400_000);
      const rows = await db
        .select()
        .from(billings)
        .where(
          and(inArray(billings.projectId, [...titles.keys()]), gte(billings.createdAt, since)),
        );
      const approved = await deps.approved(scope, rows);
      const orders = await db
        .select()
        .from(workOrders)
        .where(
          and(
            eq(workOrders.organizationId, scope.organizationId),
            inArray(workOrders.status, ["signed", "completed"]),
          ),
        );
      const lines = orders.length
        ? await db
            .select()
            .from(workOrderLines)
            .where(
              inArray(
                workOrderLines.workOrderId,
                orders.map((o) => o.id),
              ),
            )
        : [];
      const accountsByOrder = new Map(
        await Promise.all(
          orders.map(async (o) => [o.id, await deps.accountsOf(scope, o.nearAccount)] as const),
        ),
      );
      const covers = (b: (typeof rows)[number]) =>
        orders.some(
          (o) =>
            (accountsByOrder.get(o.id) ?? []).includes(b.nearAccount ?? "") &&
            b.createdAt >= new Date(`${o.startsOn}T00:00:00Z`) &&
            (!o.closedAt || b.createdAt <= o.closedAt) &&
            lines.some(
              (l) =>
                l.workOrderId === o.id && l.projectId === b.projectId && l.tokenId === b.tokenId,
            ),
        );
      return {
        data: rows
          .filter((b, i) => approved[i] && !covers(b))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((b) => ({
            billingId: b.id,
            projectId: b.projectId,
            projectTitle: titles.get(b.projectId) ?? null,
            nearAccount: b.nearAccount,
            tokenId: b.tokenId,
            amount: b.amount,
            recordedAt: b.createdAt.toISOString(),
          })),
      };
    },
  };
}

export type WorkOrdersService = ReturnType<typeof createWorkOrdersService>;
