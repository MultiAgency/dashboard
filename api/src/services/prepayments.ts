import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { budgets, type Prepayment, prepayments } from "../db/schema";
import type { AgencyScope, OrgScope } from "../lib/agency-scope";
import type { EngagementsService } from "./engagements";

export type TokenAmount = { tokenId: string; amount: string };

const prepaymentNotFound = () => new ORPCError("NOT_FOUND", { message: "Prepayment not found" });

function assertPeriod(periodStart: string, periodEnd: string) {
  if (periodStart > periodEnd) {
    throw new ORPCError("BAD_REQUEST", { message: "periodStart must be on or before periodEnd" });
  }
}

export async function prepaidBalance(db: Database, engagementId: string): Promise<TokenAmount[]> {
  const [paid, spent] = await Promise.all([
    db
      .select({ tokenId: prepayments.tokenId, amount: prepayments.amount })
      .from(prepayments)
      .where(eq(prepayments.engagementId, engagementId)),
    db
      .select({ tokenId: budgets.tokenId, amount: budgets.amount })
      .from(budgets)
      .where(and(isNotNull(budgets.engagementId), eq(budgets.engagementId, engagementId))),
  ]);
  const totals = new Map<string, bigint>();
  for (const row of paid)
    totals.set(row.tokenId, (totals.get(row.tokenId) ?? 0n) + BigInt(row.amount));
  for (const row of spent)
    totals.set(row.tokenId, (totals.get(row.tokenId) ?? 0n) - BigInt(row.amount));
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tokenId, amount]) => ({ tokenId, amount: amount.toString() }));
}

export function createPrepaymentsService(db: Database, engagements: EngagementsService) {
  const requireOwn = (scope: AgencyScope, id: string) =>
    Effect.gen(function* () {
      const [row] = yield* Effect.promise(() =>
        db.select().from(prepayments).where(eq(prepayments.id, id)).limit(1),
      );
      if (!row) return yield* Effect.fail(prepaymentNotFound());
      yield* Effect.mapError(engagements.asAgency(scope, row.engagementId), prepaymentNotFound);
      return row;
    });

  return {
    list: (scope: OrgScope, engagementId: string) =>
      Effect.gen(function* () {
        yield* engagements.asParty(scope, engagementId);
        const [data, balance] = yield* Effect.promise(() =>
          Promise.all([
            db
              .select()
              .from(prepayments)
              .where(eq(prepayments.engagementId, engagementId))
              .orderBy(desc(prepayments.periodStart), desc(prepayments.createdAt)),
            prepaidBalance(db, engagementId),
          ]),
        );
        return { data, balance };
      }),

    record: (
      scope: AgencyScope,
      input: {
        engagementId: string;
        tokenId: string;
        amount: string;
        periodStart: string;
        periodEnd: string;
        transferReference?: string;
      },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* engagements.asAgency(scope, input.engagementId);
        if (engagement.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Prepayments can only be recorded on an active Engagement.",
            }),
          );
        }
        assertPeriod(input.periodStart, input.periodEnd);
        const [row] = yield* Effect.promise(() =>
          db
            .insert(prepayments)
            .values({
              id: crypto.randomUUID(),
              engagementId: engagement.id,
              tokenId: input.tokenId,
              amount: input.amount,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              transferReference: input.transferReference?.trim() || null,
              actorAccountId: scope.actorId,
            })
            .returning(),
        );
        return row as Prepayment;
      }),

    correct: (
      scope: AgencyScope,
      input: {
        id: string;
        tokenId?: string;
        amount?: string;
        periodStart?: string;
        periodEnd?: string;
        transferReference?: string | null;
      },
    ) =>
      Effect.gen(function* () {
        const existing = yield* requireOwn(scope, input.id);
        assertPeriod(
          input.periodStart ?? existing.periodStart,
          input.periodEnd ?? existing.periodEnd,
        );
        const [row] = yield* Effect.promise(() =>
          db
            .update(prepayments)
            .set({
              tokenId: input.tokenId ?? existing.tokenId,
              amount: input.amount ?? existing.amount,
              periodStart: input.periodStart ?? existing.periodStart,
              periodEnd: input.periodEnd ?? existing.periodEnd,
              transferReference:
                input.transferReference === undefined
                  ? existing.transferReference
                  : input.transferReference?.trim() || null,
              updatedAt: new Date(),
            })
            .where(eq(prepayments.id, input.id))
            .returning(),
        );
        return row as Prepayment;
      }),

    remove: (scope: AgencyScope, id: string) =>
      Effect.gen(function* () {
        yield* requireOwn(scope, id);
        yield* Effect.promise(() => db.delete(prepayments).where(eq(prepayments.id, id)));
        return { deleted: true as const };
      }),
  };
}

export type PrepaymentsService = ReturnType<typeof createPrepaymentsService>;
