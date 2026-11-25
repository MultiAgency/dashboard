import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db";
import { organizationApprovals, organizationApprovalsAdoption } from "../db/schema";
import type { AuthOrganizationRecord } from "../lib/organizations";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type Approval = { status: ApprovalStatus; rejectionReason: string | null };

export type ApprovalDecision = { status: "approved" } | { status: "rejected"; reason: string };

export type RecordedApproval = Approval & { organizationId: string; createdAt: Date | null };

export type OrganizationApprovals = {
  of(organizationIds: readonly string[]): Promise<Map<string, Approval>>;
  isApproved(organizationId: string): Promise<boolean>;
  decide(organizationId: string, decision: ApprovalDecision, reviewedBy: string): Promise<void>;
  adopt(recorded: () => Promise<RecordedApproval[]>): Promise<boolean>;
};

const PENDING: Approval = { status: "pending", rejectionReason: null };

export function approvalRecordedByAuth(record: AuthOrganizationRecord): RecordedApproval {
  const recorded = {
    organizationId: record.organization.id,
    createdAt: record.organization.createdAt,
  };
  if (record.status === "pending") return { ...recorded, ...PENDING };
  if (record.status === "rejected") {
    return { ...recorded, status: "rejected", rejectionReason: record.rejectionReason };
  }
  return { ...recorded, status: "approved", rejectionReason: null };
}

export function createOrganizationApprovals(
  db: Database,
  now: () => Date = () => new Date(),
): OrganizationApprovals {
  async function of(organizationIds: readonly string[]): Promise<Map<string, Approval>> {
    const ids = [...new Set(organizationIds)];
    const rows = ids.length
      ? await db
          .select()
          .from(organizationApprovals)
          .where(inArray(organizationApprovals.organizationId, ids))
      : [];
    const recorded = new Map(
      rows.map((row) => [
        row.organizationId,
        { status: row.status, rejectionReason: row.rejectionReason },
      ]),
    );
    return new Map(ids.map((id) => [id, recorded.get(id) ?? PENDING]));
  }

  return {
    of,

    isApproved: async (organizationId) =>
      (await of([organizationId])).get(organizationId)?.status === "approved",

    decide: async (organizationId, decision, reviewedBy) => {
      const values = {
        status: decision.status,
        rejectionReason: decision.status === "rejected" ? decision.reason : null,
        reviewedBy,
        reviewedAt: now(),
      };
      await db
        .insert(organizationApprovals)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: organizationApprovals.organizationId, set: values });
    },

    adopt: async (recorded) => {
      const [adoption] = await db.select().from(organizationApprovalsAdoption).limit(1);
      if (!adoption || adoption.adoptedAt) return false;
      const existing = await recorded();
      return db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(organizationApprovalsAdoption)
          .set({ adoptedAt: now() })
          .where(
            and(
              eq(organizationApprovalsAdoption.id, adoption.id),
              isNull(organizationApprovalsAdoption.adoptedAt),
            ),
          )
          .returning();
        if (!claimed) return false;
        const decided = existing
          .filter((record) => !record.createdAt || record.createdAt < claimed.cutoff)
          .map(({ createdAt: _, ...approval }) => approval);
        if (decided.length > 0) {
          await tx.insert(organizationApprovals).values(decided).onConflictDoNothing();
        }
        return true;
      });
    },
  };
}
