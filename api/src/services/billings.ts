import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { billings, contributors } from "../db/schema";
import type { AgencyService } from "./agency";
import { enrichWithChainStatus, getProposal } from "./sputnik";
import { NATIVE_TOKEN_ID } from "./tokens";

export function createBillingsService(db: Database, agency: AgencyService) {
  return {
    list: (
      input: {
        projectId?: string;
        contributorId?: string;
        cursor?: string;
        limit: number;
      },
      orgAccountId: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        if (input.projectId) {
          yield* Effect.promise(() =>
            agency.requireProjectInOrg(input.projectId!, orgAccountId as string, context),
          );
        }
        const projectIds = input.projectId
          ? [input.projectId]
          : (yield* Effect.promise(() => agency.fetchOrgProjects(orgAccountId, context))).map(
              (p: { id: string }) => p.id,
            );

        const selectBillingCols = {
          id: billings.id,
          projectId: billings.projectId,
          contributorId: billings.contributorId,
          tokenId: billings.tokenId,
          amount: billings.amount,
          proposalId: billings.proposalId,
          note: billings.note,
          createdAt: billings.createdAt,
        } as const;

        const rows = yield* Effect.promise(() =>
          db
            .select(selectBillingCols)
            .from(billings)
            .where(
              and(
                inArray(billings.projectId, projectIds),
                input.contributorId ? eq(billings.contributorId, input.contributorId) : undefined,
                cursorWhere(billings.createdAt, billings.id, input.cursor),
              ),
            )
            .orderBy(desc(billings.createdAt), desc(billings.id))
            .limit(input.limit),
        );
        const last = rows[rows.length - 1];
        const enriched = yield* Effect.promise(() =>
          Promise.all(rows.map((b) => enrichWithChainStatus(db, b, orgAccountId))),
        );
        return {
          data: enriched,
          nextCursor:
            rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
        };
      }),

    create: (
      input: {
        projectId: string;
        contributorId?: string;
        proposalId: string;
        note?: string;
      },
      orgAccountId: string,
      context: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const orgProjects = yield* Effect.promise(() =>
          agency.fetchOrgProjects(orgAccountId, context),
        );
        if (!orgProjects.some((p) => p.id === input.projectId)) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }

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
            .where(eq(billings.proposalId, input.proposalId))
            .limit(1),
        );
        if (existing.length > 0) {
          const e = existing[0]!;
          const project = orgProjects.find((p) => p.id === e.projectId);
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is already assigned to ${
                project?.title ?? e.projectId
              } (@${project?.slug ?? "?"})`,
            }),
          );
        }

        const proposal = yield* Effect.promise(() => getProposal(db, orgAccountId, proposalIdNum));
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

        let contributorId = input.contributorId ?? null;
        if (!contributorId) {
          const found = yield* Effect.promise(() =>
            db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.nearAccountId, transferKind.receiverId))
              .limit(1),
          );
          contributorId = found[0]?.id ?? null;
        }

        const id = crypto.randomUUID();
        const result = yield* Effect.promise(() =>
          db
            .insert(billings)
            .values({
              id,
              projectId: input.projectId,
              contributorId,
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
        const enhanced = yield* Effect.promise(() => enrichWithChainStatus(db, row, orgAccountId));
        return { billing: enhanced };
      }),

    delete: (input: { id: string }, orgAccountId: string, context: Record<string, unknown>) =>
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
        yield* Effect.promise(() =>
          agency.requireProjectInOrg(row.projectId, orgAccountId, context),
        );
        yield* Effect.promise(() => db.delete(billings).where(eq(billings.id, input.id)));
        return { deleted: true as const };
      }),
  };
}

export type BillingsService = ReturnType<typeof createBillingsService>;
