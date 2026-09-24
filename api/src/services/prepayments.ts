import { desc, eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type EngagementRow, engagements, type PrepaymentRow, prepayments } from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import { applyPlanForPeriod, type PlanApplication } from "./allocation-plan";
import type { NotificationKind, NotificationsService } from "./notifications";
import { type OrganizationScope, requireTreasury, SHARED_STATUSES } from "./organization-access";
import { lockEngagement, prepaidBalanceRows, prepaidBalances } from "./prepaid-balance";
import { baseUnitsToDisplay } from "./tokens";

export type PrepaymentView = {
  id: string;
  engagementId: string;
  daoAccountId: string;
  tokenId: string;
  amount: string;
  period: string;
  transferReference: string | null;
  actorAccountId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RecordPrepaymentInput = {
  engagementId: string;
  tokenId: string;
  amount: string;
  period: string;
  transferReference?: string | null;
};

export type CorrectPrepaymentInput = {
  id: string;
  tokenId?: string;
  amount?: string;
  period?: string;
  transferReference?: string | null;
};

const notFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });
const prepaymentNotFound = () => new ORPCError("NOT_FOUND", { message: "Prepayment not found" });
const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function requireValid(values: { amount?: string; period?: string }) {
  if (values.amount !== undefined && !/^[1-9]\d*$/.test(values.amount)) {
    throw badRequest("INVALID_AMOUNT", "A Prepayment amount must be a positive whole number.");
  }
  if (values.period !== undefined && !PERIOD.test(values.period)) {
    throw badRequest("INVALID_PERIOD", "A period is a calendar month written as YYYY-MM.");
  }
}

function view(row: PrepaymentRow): PrepaymentView {
  return {
    id: row.id,
    engagementId: row.engagementId,
    daoAccountId: row.daoAccountId,
    tokenId: row.tokenId,
    amount: row.amount,
    period: row.period,
    transferReference: row.transferReference,
    actorAccountId: row.actorAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrepaymentsService(deps: {
  db: Database;
  organizations: OrganizationDirectory;
  notifications: NotificationsService;
  onPlanApplied?: (
    scope: OrganizationScope,
    engagement: EngagementRow,
    application: PlanApplication,
  ) => Promise<void>;
  now?: () => Date;
}) {
  const { db, organizations, notifications } = deps;
  const now = deps.now ?? (() => new Date());

  async function readable(scope: OrganizationScope, engagementId: string) {
    const [row] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.id, engagementId))
      .limit(1);
    if (!row) throw notFound();
    if (row.agencyOrganizationId === scope.organizationId) return row;
    if (row.clientOrganizationId === scope.organizationId && SHARED_STATUSES.includes(row.status))
      return row;
    throw notFound();
  }

  function requireWritable(scope: OrganizationScope, row: EngagementRow | null) {
    if (!row || row.agencyOrganizationId !== scope.organizationId) throw notFound();
    if (row.status !== "active") {
      throw badRequest(
        "NOT_ACTIVE",
        "Prepayments can only be recorded, corrected or removed on an active Engagement.",
      );
    }
    return row;
  }

  async function guardBalance(tx: Database, engagementId: string, tokenId: string) {
    const before = (await prepaidBalances(tx, engagementId)).get(tokenId) ?? 0n;
    return async () => {
      const after = (await prepaidBalances(tx, engagementId)).get(tokenId) ?? 0n;
      if (after < 0n && after < before) {
        throw badRequest(
          "PREPAID_BALANCE_NEGATIVE",
          `The Prepaid balance in ${tokenId} would go below zero, because Budget entries already use it.`,
        );
      }
    };
  }

  async function loadPrepayment(tx: Database, id: string): Promise<PrepaymentRow> {
    const [row] = await tx.select().from(prepayments).where(eq(prepayments.id, id)).limit(1);
    if (!row) throw prepaymentNotFound();
    return row;
  }

  async function lockPrepayment(scope: OrganizationScope, tx: Database, id: string) {
    const { engagementId } = await loadPrepayment(tx, id);
    const engagement = requireWritable(scope, await lockEngagement(tx, engagementId));
    return { current: await loadPrepayment(tx, id), engagement };
  }

  async function tellClient(
    scope: OrganizationScope,
    engagement: EngagementRow,
    kind: NotificationKind,
    prepayment: PrepaymentRow,
  ) {
    try {
      const agency = await organizations.get(engagement.agencyOrganizationId);
      await notifications.notify({
        organizationId: engagement.clientOrganizationId,
        kind,
        payload: {
          agencyName: agency?.name ?? engagement.agencyOrganizationId,
          engagementId: engagement.id,
          tokenId: prepayment.tokenId,
          amount: baseUnitsToDisplay(prepayment.amount, prepayment.tokenId),
          period: prepayment.period,
        },
        link: `/client/${engagement.id}/prepayments`,
        excludeUserId: scope.pluginContext.userId ?? null,
      });
    } catch (err) {
      console.warn("[API] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    list: async (scope: OrganizationScope, input: { engagementId: string }) => {
      const engagement = await readable(scope, input.engagementId);
      const rows = await db
        .select()
        .from(prepayments)
        .where(eq(prepayments.engagementId, engagement.id))
        .orderBy(desc(prepayments.period), desc(prepayments.createdAt), desc(prepayments.id));
      return { data: rows.map(view) };
    },

    balance: async (scope: OrganizationScope, input: { engagementId: string }) => {
      const engagement = await readable(scope, input.engagementId);
      return { data: await prepaidBalanceRows(db, engagement.id) };
    },

    record: async (scope: OrganizationScope, input: RecordPrepaymentInput) => {
      const treasury = requireTreasury(scope);
      requireValid(input);
      const { engagement, row, application } = await db.transaction(async (tx) => {
        const engagement = requireWritable(
          scope,
          await lockEngagement(tx as Database, input.engagementId),
        );
        const [row] = await tx
          .insert(prepayments)
          .values({
            id: crypto.randomUUID(),
            engagementId: engagement.id,
            daoAccountId: treasury.agencyDao,
            tokenId: input.tokenId,
            amount: input.amount,
            period: input.period,
            transferReference: input.transferReference?.trim() || null,
            actorAccountId: scope.actorId,
          })
          .returning();
        const application = await applyPlanForPeriod(tx as Database, engagement, {
          period: input.period,
          prepaymentId: row!.id,
          actorAccountId: scope.actorId,
          now: now(),
        });
        return { engagement, row: row!, application };
      });
      await tellClient(scope, engagement, "prepayment_recorded", row);
      if (application) await deps.onPlanApplied?.(scope, engagement, application);
      return view(row);
    },

    correct: async (scope: OrganizationScope, input: CorrectPrepaymentInput) => {
      requireTreasury(scope);
      requireValid(input);
      const { engagement, row } = await db.transaction(async (tx) => {
        const { current, engagement } = await lockPrepayment(scope, tx as Database, input.id);
        const covered = await guardBalance(tx as Database, engagement.id, current.tokenId);
        const [row] = await tx
          .update(prepayments)
          .set({
            tokenId: input.tokenId ?? current.tokenId,
            amount: input.amount ?? current.amount,
            period: input.period ?? current.period,
            transferReference:
              input.transferReference === undefined
                ? current.transferReference
                : input.transferReference?.trim() || null,
            updatedAt: now(),
          })
          .where(eq(prepayments.id, current.id))
          .returning();
        await covered();
        return { engagement, row: row! };
      });
      await tellClient(scope, engagement, "prepayment_corrected", row);
      return view(row);
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      requireTreasury(scope);
      const { engagement, row } = await db.transaction(async (tx) => {
        const { current, engagement } = await lockPrepayment(scope, tx as Database, input.id);
        const covered = await guardBalance(tx as Database, engagement.id, current.tokenId);
        await tx.delete(prepayments).where(eq(prepayments.id, current.id));
        await covered();
        return { engagement, row: current };
      });
      await tellClient(scope, engagement, "prepayment_removed", row);
      return { ok: true as const };
    },
  };
}

export type PrepaymentsService = ReturnType<typeof createPrepaymentsService>;
