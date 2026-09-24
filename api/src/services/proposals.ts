import { and, inArray } from "drizzle-orm";
import { Effect, Either } from "every-plugin/effect";
import type { z } from "every-plugin/zod";
import type { proposalPublicItem } from "../contract";
import type { Database } from "../db";
import { billings } from "../db/schema";
import { paidBy } from "./billings";
import type { TreasuryScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";
import { type DaoProposal, getLastProposalId, getProposals } from "./sputnik";
import { summarizeProposals } from "./summaries";
import { NATIVE_TOKEN_ID } from "./tokens";

const PROPOSAL_FETCH_PAGE_SIZE = 100;
const PROPOSAL_FETCH_MAX_ITERATIONS = 5;

async function fetchTransferProposals(
  db: Database,
  agencyDao: string,
  fromIndex: number | undefined,
  limit: number,
): Promise<{
  transfers: DaoProposal[];
  lastProposalId: number;
  nextFromIndex: number | null;
}> {
  const lastProposalId = await getLastProposalId(agencyDao);
  if (lastProposalId === 0) {
    return { transfers: [], lastProposalId: 0, nextFromIndex: null };
  }
  const transfers: DaoProposal[] = [];
  let cursor = fromIndex ?? lastProposalId;
  let iterations = 0;
  while (transfers.length < limit && cursor > 0 && iterations < PROPOSAL_FETCH_MAX_ITERATIONS) {
    const startIndex = Math.max(0, cursor - PROPOSAL_FETCH_PAGE_SIZE);
    const fetched = await getProposals(db, agencyDao, startIndex, cursor - startIndex);
    for (const p of fetched.slice().reverse()) {
      if (p.kind.type === "Transfer") {
        transfers.push(p);
        if (transfers.length >= limit) break;
      }
    }
    cursor = startIndex;
    iterations++;
  }
  return {
    transfers,
    lastProposalId,
    nextFromIndex: cursor > 0 ? cursor : null,
  };
}

function toProposalPublicItem(p: DaoProposal): z.infer<typeof proposalPublicItem> {
  const transfer = p.kind.type === "Transfer" ? p.kind : null;
  return {
    proposalId: String(p.id),
    proposer: p.proposer,
    description: p.description,
    status: p.status,
    tokenId: transfer ? (transfer.tokenId === "" ? NATIVE_TOKEN_ID : transfer.tokenId) : "",
    receiverId: transfer?.receiverId ?? "",
    amount: transfer?.amount ?? "0",
    submissionTime: p.submissionTime,
    votes: p.votes,
  };
}

export function createProposalsService(db: Database, directory: ProjectDirectory) {
  return {
    list: (scope: TreasuryScope, input: { fromIndex?: number; limit: number }) =>
      Effect.gen(function* () {
        const isContributor = scope.canSeePrivate;

        const fetched = yield* Effect.either(
          Effect.tryPromise(() =>
            fetchTransferProposals(db, scope.agencyDao, input.fromIndex, input.limit),
          ),
        );
        if (Either.isLeft(fetched)) {
          if (isContributor) return yield* Effect.die(fetched.left.error);
          return { data: [], lastProposalId: 0, nextFromIndex: null };
        }
        const { transfers, lastProposalId, nextFromIndex } = fetched.right;

        if (!isContributor) {
          return {
            data: transfers.map((p) => ({
              ...toProposalPublicItem(p),
              mapping: null,
            })),
            lastProposalId,
            nextFromIndex,
          };
        }

        const proposalIdStrs = transfers.map((p) => String(p.id));
        const orgProjects = yield* Effect.promise(() => directory.forAgency(scope).list());

        const localBillings =
          proposalIdStrs.length > 0
            ? yield* Effect.promise(() =>
                db
                  .select({
                    billingId: billings.id,
                    proposalId: billings.proposalId,
                    projectId: billings.projectId,
                  })
                  .from(billings)
                  .where(
                    and(inArray(billings.proposalId, proposalIdStrs), paidBy(scope.agencyDao)),
                  ),
              )
            : [];

        const orgProjectIds = new Set(orgProjects.map((p) => p.id));
        const mappingByProposal = new Map(
          localBillings.filter((b) => orgProjectIds.has(b.projectId)).map((b) => [b.proposalId, b]),
        );

        const data = transfers.map((p) => {
          const m = mappingByProposal.get(String(p.id));
          const project = m ? orgProjects.find((p) => p.id === m.projectId) : undefined;
          return {
            ...toProposalPublicItem(p),
            mapping:
              m && project
                ? {
                    billingId: m.billingId,
                    projectId: m.projectId,
                    projectSlug: project.slug,
                    projectTitle: project.title,
                  }
                : null,
          };
        });

        return { data, lastProposalId, nextFromIndex };
      }),

    getPublicSummary: (scope: TreasuryScope) =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise(async () => {
          const lastProposalId = await getLastProposalId(scope.agencyDao);
          if (lastProposalId === 0) return summarizeProposals([], 0);
          const pageSize = Math.min(100, lastProposalId);
          const recent = await getProposals(
            db,
            scope.agencyDao,
            Math.max(0, lastProposalId - pageSize),
            pageSize,
          );
          return summarizeProposals(recent, lastProposalId);
        }).pipe(Effect.orElseSucceed(() => summarizeProposals([], 0)));
      }),
  };
}

export type ProposalsService = ReturnType<typeof createProposalsService>;
