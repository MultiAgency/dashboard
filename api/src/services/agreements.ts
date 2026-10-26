import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  type AGREEMENT_KINDS,
  budgets,
  type ClientAgreement,
  clientAgreements,
  engagementProjects,
  engagements,
} from "../db/schema";
import { type OrganizationScope, SHARED_STATUSES } from "./organization-access";

export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export type AgreementFields = {
  kind: AgreementKind;
  title: string;
  startDate: string;
  endDate: string;
  tokenId: string;
  agreedAmount: string;
  note?: string | null;
};

export type AgreementView = ClientAgreement & { allocated: string; budgetCount: number };

const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });

const agreementNotFound = () => new ORPCError("NOT_FOUND", { message: "Agreement not found" });

const engagementNotFound = () => new ORPCError("NOT_FOUND", { message: "Engagement not found" });

function validate(
  fields: Pick<AgreementFields, "title" | "startDate" | "endDate" | "agreedAmount">,
) {
  if (!fields.title.trim()) throw badRequest("TITLE_REQUIRED", "Give the agreement a title");
  if (fields.endDate < fields.startDate) {
    throw badRequest("INVALID_PERIOD", "The end date must be on or after the start date");
  }
  if (BigInt(fields.agreedAmount) <= 0n) {
    throw badRequest("AMOUNT_NOT_POSITIVE", "The agreed amount must be more than zero");
  }
}

export async function clientEngagementIdsForProject(
  db: Database,
  agencyOrganizationId: string | null,
  projectId: string,
): Promise<string[]> {
  if (!agencyOrganizationId) return [];
  const rows = await db
    .select({ id: engagements.id })
    .from(engagementProjects)
    .innerJoin(engagements, eq(engagements.id, engagementProjects.engagementId))
    .where(
      and(
        eq(engagementProjects.projectId, projectId),
        eq(engagements.agencyOrganizationId, agencyOrganizationId),
        eq(engagements.kind, "client"),
        inArray(engagements.status, SHARED_STATUSES),
      ),
    );
  return rows.map((r) => r.id);
}

export async function withAllocations(
  db: Database,
  rows: ClientAgreement[],
): Promise<AgreementView[]> {
  if (rows.length === 0) return [];
  const attached = await db
    .select({ agreementId: budgets.agreementId, tokenId: budgets.tokenId, amount: budgets.amount })
    .from(budgets)
    .where(
      inArray(
        budgets.agreementId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((row) => {
    const mine = attached.filter((b) => b.agreementId === row.id);
    const allocated = mine
      .filter((b) => b.tokenId === row.tokenId)
      .reduce((sum, b) => sum + BigInt(b.amount), 0n);
    return { ...row, allocated: allocated.toString(), budgetCount: mine.length };
  });
}

export async function agreementsOfEngagement(
  db: Database,
  engagementId: string,
): Promise<AgreementView[]> {
  const rows = await db
    .select()
    .from(clientAgreements)
    .where(eq(clientAgreements.engagementId, engagementId))
    .orderBy(desc(clientAgreements.startDate), asc(clientAgreements.title));
  return withAllocations(db, rows);
}

export function createAgreementsService(db: Database) {
  async function agencyEngagement(
    scope: OrganizationScope,
    engagementId: string,
    writable: boolean,
  ) {
    const [row] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.id, engagementId))
      .limit(1);
    if (
      !row ||
      row.agencyOrganizationId !== scope.organizationId ||
      row.kind !== "client" ||
      !SHARED_STATUSES.includes(row.status)
    ) {
      throw engagementNotFound();
    }
    if (writable && row.status !== "active") {
      throw badRequest(
        "NOT_ACTIVE",
        "Agreements can only be added or changed on an active Engagement",
      );
    }
    return row;
  }

  async function ownAgreement(scope: OrganizationScope, id: string, writable: boolean) {
    const [row] = await db
      .select()
      .from(clientAgreements)
      .where(eq(clientAgreements.id, id))
      .limit(1);
    if (!row) throw agreementNotFound();
    try {
      await agencyEngagement(scope, row.engagementId, writable);
    } catch (err) {
      if (err instanceof ORPCError && err.code === "NOT_FOUND") throw agreementNotFound();
      throw err;
    }
    return row;
  }

  return {
    list: async (
      scope: OrganizationScope,
      input: { engagementId?: string; projectId?: string },
    ): Promise<{ data: AgreementView[] }> => {
      let engagementIds: string[];
      if (input.engagementId) {
        await agencyEngagement(scope, input.engagementId, false);
        engagementIds = [input.engagementId];
      } else if (input.projectId) {
        engagementIds = await clientEngagementIdsForProject(
          db,
          scope.organizationId,
          input.projectId,
        );
      } else {
        engagementIds = (
          await db
            .select({ id: engagements.id })
            .from(engagements)
            .where(
              and(
                eq(engagements.agencyOrganizationId, scope.organizationId),
                eq(engagements.kind, "client"),
                inArray(engagements.status, SHARED_STATUSES),
              ),
            )
        ).map((r) => r.id);
      }
      if (engagementIds.length === 0) return { data: [] };
      const rows = await db
        .select()
        .from(clientAgreements)
        .where(inArray(clientAgreements.engagementId, engagementIds))
        .orderBy(desc(clientAgreements.startDate), asc(clientAgreements.title));
      return { data: await withAllocations(db, rows) };
    },

    create: async (
      scope: OrganizationScope,
      input: AgreementFields & { engagementId: string },
    ): Promise<AgreementView> => {
      await agencyEngagement(scope, input.engagementId, true);
      validate(input);
      const [row] = await db
        .insert(clientAgreements)
        .values({
          id: crypto.randomUUID(),
          engagementId: input.engagementId,
          kind: input.kind,
          title: input.title.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          tokenId: input.tokenId,
          agreedAmount: input.agreedAmount,
          note: input.note?.trim() || null,
          createdBy: scope.actorId,
        })
        .returning();
      const [view] = await withAllocations(db, [row!]);
      return view!;
    },

    update: async (
      scope: OrganizationScope,
      input: Partial<AgreementFields> & { id: string },
    ): Promise<AgreementView> => {
      const row = await ownAgreement(scope, input.id, true);
      const next = {
        kind: input.kind ?? row.kind,
        title: input.title?.trim() ?? row.title,
        startDate: input.startDate ?? row.startDate,
        endDate: input.endDate ?? row.endDate,
        tokenId: input.tokenId ?? row.tokenId,
        agreedAmount: input.agreedAmount ?? row.agreedAmount,
        note: input.note === undefined ? row.note : input.note?.trim() || null,
      };
      validate(next);
      if (next.tokenId !== row.tokenId) {
        const [current] = await withAllocations(db, [row]);
        if (current!.budgetCount > 0) {
          throw badRequest(
            "TOKEN_IN_USE",
            "Budget entries are attached to this agreement, so its token can't change",
          );
        }
      }
      const [updated] = await db
        .update(clientAgreements)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(clientAgreements.id, row.id))
        .returning();
      const [view] = await withAllocations(db, [updated!]);
      return view!;
    },

    remove: async (scope: OrganizationScope, input: { id: string }) => {
      const row = await ownAgreement(scope, input.id, true);
      const [current] = await withAllocations(db, [row]);
      if (current!.budgetCount > 0) {
        throw badRequest(
          "AGREEMENT_IN_USE",
          `${current!.budgetCount} budget ${
            current!.budgetCount === 1 ? "entry is" : "entries are"
          } attached to this agreement. Move or delete them first.`,
        );
      }
      await db.delete(clientAgreements).where(eq(clientAgreements.id, row.id));
      return { deleted: true as const };
    },
  };
}

export type AgreementsService = ReturnType<typeof createAgreementsService>;
