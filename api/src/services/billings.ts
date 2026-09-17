import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { billings } from "../db/schema";
import type { AgencyScope } from "../lib/agency-scope";
import type { ProjectDirectory } from "./project-directory";
import { enrichWithChainStatus, getProposal } from "./sputnik";
import { NATIVE_TOKEN_ID } from "./tokens";

export function createBillingsService(db: Database, directory: ProjectDirectory) {
  return {
    list: (
      scope: AgencyScope,
      input: {
        projectId?: string;
        projectIds?: string[];
        nearAccount?: string;
        clientId?: string;
        cursor?: string;
        limit: number;
      },
    ) =>
      Effect.gen(function* () {
        const projects = directory.forAgency(scope);
        let projectIds: string[];
        if (input.projectId) {
          const project = yield* Effect.promise(() => projects.require(input.projectId!));
          projectIds =
            input.projectIds && !input.projectIds.includes(project.id) ? [] : [project.id];
        } else if (input.projectIds) {
          const inAgency = new Set(
            (yield* Effect.promise(() => projects.list())).map((project) => project.id),
          );
          projectIds = input.projectIds.filter((id) => inAgency.has(id));
        } else {
          projectIds = (yield* Effect.promise(() => projects.list())).map((project) => project.id);
        }

        if (projectIds.length === 0) {
          return { data: [], nextCursor: null };
        }

        const selectBillingCols = {
          id: billings.id,
          projectId: billings.projectId,
          nearAccount: billings.nearAccount,
          clientId: billings.clientId,
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
                input.nearAccount ? eq(billings.nearAccount, input.nearAccount) : undefined,
                input.clientId ? eq(billings.clientId, input.clientId) : undefined,
                cursorWhere(billings.createdAt, billings.id, input.cursor),
              ),
            )
            .orderBy(desc(billings.createdAt), desc(billings.id))
            .limit(input.limit),
        );
        const last = rows[rows.length - 1];
        const enriched = yield* Effect.promise(() =>
          Promise.all(rows.map((b) => enrichWithChainStatus(db, b, scope.agencyDao))),
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
        clientId?: string;
        proposalId: string;
        note?: string;
      },
    ) =>
      Effect.gen(function* () {
        const orgProjects = yield* Effect.promise(() => directory.forAgency(scope).list());
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
              clientId: input.clientId ?? null,
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
