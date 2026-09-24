import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { billings } from "../db/schema";
import type { OrganizationAccessService, TreasuryScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";
import { enrichWithChainStatus, getProposal } from "./sputnik";
import { NATIVE_TOKEN_ID } from "./tokens";

const selectBillingCols = {
  id: billings.id,
  projectId: billings.projectId,
  nearAccount: billings.nearAccount,
  tokenId: billings.tokenId,
  amount: billings.amount,
  proposalId: billings.proposalId,
  payingDaoAccountId: billings.payingDaoAccountId,
  note: billings.note,
  createdAt: billings.createdAt,
} as const;

export function payingDaoOf(
  billing: { payingDaoAccountId: string | null },
  owningDao: string | null,
): string | null {
  return billing.payingDaoAccountId ?? owningDao;
}

export async function withPayingStatus<
  T extends { proposalId: string; payingDaoAccountId: string | null },
>(db: Database, billing: T, owningDao: string | null) {
  const payingDaoAccountId = payingDaoOf(billing, owningDao);
  if (!payingDaoAccountId) {
    return { ...billing, payingDaoAccountId: "", status: "InProgress" as const };
  }
  return enrichWithChainStatus(db, { ...billing, payingDaoAccountId }, payingDaoAccountId);
}

const paidBy = (daoAccountId: string) =>
  or(eq(billings.payingDaoAccountId, daoAccountId), isNull(billings.payingDaoAccountId));

export function createBillingsService(
  db: Database,
  directory: ProjectDirectory,
  access: Pick<OrganizationAccessService, "workableProject" | "subcontractedProjects">,
) {
  const workable = (scope: TreasuryScope, projectId: string, write = false) =>
    Effect.tryPromise({
      try: () => access.workableProject(scope, projectId, { write }),
      catch: (err) => err,
    });

  return {
    list: (
      scope: TreasuryScope,
      input: {
        projectId?: string;
        projectIds?: string[];
        nearAccount?: string;
        payingDaoAccountId?: string;
        cursor?: string;
        limit: number;
      },
    ) =>
      Effect.gen(function* () {
        const [owned, shared] = yield* Effect.promise(() =>
          Promise.all([directory.forAgency(scope).list(), access.subcontractedProjects(scope)]),
        );
        const ownedIds = new Set(owned.map((p) => p.id));
        const sharedIds = new Set(
          shared.map((s) => s.project.id).filter((id) => !ownedIds.has(id)),
        );
        const visible = (id: string) => ownedIds.has(id) || sharedIds.has(id);
        const requested = input.projectId
          ? [input.projectId].filter((id) => !input.projectIds || input.projectIds.includes(id))
          : (input.projectIds ?? [...ownedIds, ...sharedIds]);
        if (input.projectId && !visible(input.projectId)) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }
        const projectIds = requested.filter(visible);
        const ownIds = projectIds.filter((id) => ownedIds.has(id));
        const subcontractedIds = projectIds.filter((id) => sharedIds.has(id));

        if (projectIds.length === 0) {
          return { data: [], nextCursor: null };
        }

        const rows = yield* Effect.promise(() =>
          db
            .select(selectBillingCols)
            .from(billings)
            .where(
              and(
                or(
                  ownIds.length > 0 ? inArray(billings.projectId, ownIds) : undefined,
                  subcontractedIds.length > 0
                    ? and(
                        inArray(billings.projectId, subcontractedIds),
                        eq(billings.payingDaoAccountId, scope.agencyDao),
                      )
                    : undefined,
                ),
                input.payingDaoAccountId
                  ? eq(billings.payingDaoAccountId, input.payingDaoAccountId)
                  : undefined,
                input.nearAccount ? eq(billings.nearAccount, input.nearAccount) : undefined,
                cursorWhere(billings.createdAt, billings.id, input.cursor),
              ),
            )
            .orderBy(desc(billings.createdAt), desc(billings.id))
            .limit(input.limit),
        );
        const last = rows[rows.length - 1];
        const enriched = yield* Effect.promise(() =>
          Promise.all(rows.map((b) => withPayingStatus(db, b, scope.agencyDao))),
        );
        return {
          data: enriched,
          nextCursor:
            rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
        };
      }),

    create: (
      scope: TreasuryScope,
      input: {
        projectId: string;
        nearAccount?: string;
        proposalId: string;
        note?: string;
      },
    ) =>
      Effect.gen(function* () {
        yield* workable(scope, input.projectId, true);

        const proposalIdNum = Number.parseInt(input.proposalId, 10);
        if (Number.isNaN(proposalIdNum)) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Invalid proposal id" }),
          );
        }

        const [existing] = yield* Effect.promise(() =>
          db
            .select({ projectId: billings.projectId })
            .from(billings)
            .where(and(eq(billings.proposalId, input.proposalId), paidBy(scope.agencyDao)))
            .limit(1),
        );
        if (existing) {
          const project = yield* Effect.promise(() =>
            access
              .workableProject(scope, existing.projectId)
              .then((found) => found.project)
              .catch(() => null),
          );
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} of ${scope.agencyDao} is already assigned to ${
                project ? `${project.title} (@${project.slug})` : "another Project"
              }`,
              data: { reason: "PROPOSAL_ALREADY_BILLED" },
            }),
          );
        }

        const proposal = yield* Effect.promise(() =>
          getProposal(db, scope.agencyDao, proposalIdNum),
        );
        if (!proposal) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: `Proposal ${input.proposalId} not found on DAO`,
            }),
          );
        }
        if (proposal.kind.type !== "Transfer") {
          const kindName = proposal.kind.type === "Other" ? proposal.kind.name : "Unknown";
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is not a funding request (kind: ${kindName})`,
            }),
          );
        }

        const transferKind = proposal.kind as {
          type: "Transfer";
          tokenId: string;
          receiverId: string;
          amount: string;
        };

        const nearAccount = input.nearAccount ?? transferKind.receiverId ?? null;

        const [row] = yield* Effect.promise(() =>
          db
            .insert(billings)
            .values({
              id: crypto.randomUUID(),
              projectId: input.projectId,
              nearAccount,
              tokenId: transferKind.tokenId === "" ? NATIVE_TOKEN_ID : transferKind.tokenId,
              amount: transferKind.amount,
              proposalId: input.proposalId,
              payingDaoAccountId: scope.agencyDao,
              note: input.note ?? null,
              createdAt: new Date(),
            })
            .returning(selectBillingCols),
        );
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" }),
          );
        }
        return { billing: yield* Effect.promise(() => withPayingStatus(db, row, scope.agencyDao)) };
      }),

    delete: (scope: TreasuryScope, input: { id: string }) =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db
            .select({
              projectId: billings.projectId,
              payingDaoAccountId: billings.payingDaoAccountId,
            })
            .from(billings)
            .where(eq(billings.id, input.id))
            .limit(1),
        );
        if (!row) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Billing not found" }));
        }
        const target = yield* workable(scope, row.projectId, true);
        const payer = payingDaoOf(row, target.relation === "owned" ? scope.agencyDao : null);
        if (payer !== scope.agencyDao) {
          return yield* Effect.fail(
            target.relation === "owned"
              ? new ORPCError("FORBIDDEN", {
                  message: "Only the Agency whose DAO paid this Billing can delete it.",
                  data: { reason: "PAID_BY_OTHER" },
                })
              : new ORPCError("NOT_FOUND", { message: "Billing not found" }),
          );
        }
        yield* Effect.promise(() => db.delete(billings).where(eq(billings.id, input.id)));
        return { deleted: true as const };
      }),
  };
}

export type BillingsService = ReturnType<typeof createBillingsService>;
