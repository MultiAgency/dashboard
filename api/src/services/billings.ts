import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { billings } from "../db/schema";
import type { AgencyScope, OrgScope } from "../lib/agency-scope";
import type { EngagementsService } from "./engagements";
import type { ProjectDirectory } from "./project-directory";
import { enrichWithChainStatus, getProposal } from "./sputnik";
import { NATIVE_TOKEN_ID } from "./tokens";

const selectBillingCols = {
  id: billings.id,
  projectId: billings.projectId,
  nearAccount: billings.nearAccount,
  daoAccountId: billings.daoAccountId,
  tokenId: billings.tokenId,
  amount: billings.amount,
  proposalId: billings.proposalId,
  note: billings.note,
  createdAt: billings.createdAt,
} as const;

export function createBillingsService(
  db: Database,
  directory: ProjectDirectory,
  engagements: EngagementsService,
) {
  const scopeOf = (scope: OrgScope) =>
    Effect.gen(function* () {
      const owned = (yield* Effect.promise(() => directory.forAgency(scope).list())).map(
        (project) => project.id,
      );
      const subcontracted = (yield* engagements.subcontractedProjects(scope))
        .map((row) => row.projectId)
        .filter((id) => !owned.includes(id));
      return { owned, subcontracted };
    });

  const visibleWhere = (
    scope: OrgScope,
    owned: string[],
    subcontracted: string[],
    requested?: string[],
  ): SQL | undefined => {
    const allow = requested ? new Set(requested) : null;
    const ownedIds = allow ? owned.filter((id) => allow.has(id)) : owned;
    const subcontractedIds = allow ? subcontracted.filter((id) => allow.has(id)) : subcontracted;
    const parts: SQL[] = [];
    if (ownedIds.length > 0) parts.push(inArray(billings.projectId, ownedIds));
    if (subcontractedIds.length > 0 && scope.agencyDao) {
      parts.push(
        and(
          inArray(billings.projectId, subcontractedIds),
          eq(billings.daoAccountId, scope.agencyDao),
        )!,
      );
    }
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return or(...parts);
  };

  return {
    list: (
      scope: OrgScope,
      input: {
        projectId?: string;
        projectIds?: string[];
        nearAccount?: string;
        cursor?: string;
        limit: number;
      },
    ) =>
      Effect.gen(function* () {
        const { owned, subcontracted } = yield* scopeOf(scope);
        let where: SQL | undefined;
        if (input.projectId) {
          if (input.projectIds && !input.projectIds.includes(input.projectId)) {
            return { data: [], nextCursor: null };
          }
          const access = yield* engagements.workOn(scope, input.projectId);
          if (access === "owned") {
            where = eq(billings.projectId, input.projectId);
          } else if (!scope.agencyDao) {
            return { data: [], nextCursor: null };
          } else {
            where = and(
              eq(billings.projectId, input.projectId),
              eq(billings.daoAccountId, scope.agencyDao),
            );
          }
        } else {
          where = visibleWhere(scope, owned, subcontracted, input.projectIds);
          if (!where) return { data: [], nextCursor: null };
        }

        const rows = yield* Effect.promise(() =>
          db
            .select(selectBillingCols)
            .from(billings)
            .where(
              and(
                where,
                input.nearAccount ? eq(billings.nearAccount, input.nearAccount) : undefined,
                cursorWhere(billings.createdAt, billings.id, input.cursor),
              ),
            )
            .orderBy(desc(billings.createdAt), desc(billings.id))
            .limit(input.limit),
        );
        const last = rows[rows.length - 1];
        const enriched = yield* Effect.promise(() =>
          Promise.all(
            rows.map((b) => enrichWithChainStatus(db, b, b.daoAccountId ?? scope.agencyDao ?? "")),
          ),
        );
        return {
          data: enriched,
          nextCursor:
            rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
        };
      }),

    create: (
      scope: AgencyScope,
      input: {
        projectId: string;
        nearAccount?: string;
        proposalId: string;
        note?: string;
      },
    ) =>
      Effect.gen(function* () {
        yield* engagements.workOn(scope, input.projectId);

        const proposalIdNum = Number.parseInt(input.proposalId, 10);
        if (Number.isNaN(proposalIdNum)) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Invalid proposal id" }),
          );
        }

        const existing = yield* Effect.promise(() =>
          db
            .select({ billingId: billings.id, projectId: billings.projectId })
            .from(billings)
            .where(
              and(
                eq(billings.proposalId, input.proposalId),
                eq(billings.daoAccountId, scope.agencyDao),
              ),
            )
            .limit(1),
        );
        if (existing.length > 0) {
          const e = existing[0]!;
          const orgProjects = yield* Effect.promise(() => directory.forAgency(scope).list());
          const project = orgProjects.find((p) => p.id === e.projectId);
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is already assigned to ${
                project?.title ?? e.projectId
              } (@${project?.slug ?? "?"})`,
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

        const id = crypto.randomUUID();
        const result = yield* Effect.promise(() =>
          db
            .insert(billings)
            .values({
              id,
              projectId: input.projectId,
              nearAccount,
              daoAccountId: scope.agencyDao,
              tokenId: transferKind.tokenId === "" ? NATIVE_TOKEN_ID : transferKind.tokenId,
              amount: transferKind.amount,
              proposalId: input.proposalId,
              note: input.note ?? null,
              createdAt: new Date(),
            })
            .returning(),
        );
        const row = result[0];
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" }),
          );
        }
        const enhanced = yield* Effect.promise(() =>
          enrichWithChainStatus(db, row, scope.agencyDao),
        );
        return { billing: enhanced };
      }),

    delete: (scope: AgencyScope, input: { id: string }) =>
      Effect.gen(function* () {
        const existing = yield* Effect.promise(() =>
          db
            .select({ id: billings.id, projectId: billings.projectId })
            .from(billings)
            .where(eq(billings.id, input.id))
            .limit(1),
        );
        const row = existing[0];
        if (!row) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Billing not found" }));
        }
        yield* Effect.promise(() => directory.forAgency(scope).require(row.projectId));
        yield* Effect.promise(() => db.delete(billings).where(eq(billings.id, input.id)));
        return { deleted: true as const };
      }),
  };
}

export type BillingsService = ReturnType<typeof createBillingsService>;
