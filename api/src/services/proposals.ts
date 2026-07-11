import { inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { z } from "every-plugin/zod";
import type { proposalPublicItem } from "../contract";
import type { Database } from "../db";
import { billings } from "../db/schema";
import type { AgencyService } from "./agency";
import { type DaoProposal, getLastProposalId, getProposals } from "./sputnik";
import { summarizeProposals } from "./summaries";
import { NATIVE_TOKEN_ID } from "./tokens";

const PROPOSAL_FETCH_PAGE_SIZE = 100;
const PROPOSAL_FETCH_MAX_ITERATIONS = 5;

async function fetchTransferProposals(
  db: Database,
  orgAccountId: string,
  fromIndex: number | undefined,
  limit: number,
): Promise<{
  transfers: DaoProposal[];
  lastProposalId: number;
  nextFromIndex: number | null;
}> {
  const lastProposalId = await getLastProposalId(orgAccountId);
  if (lastProposalId === 0) {
    return { transfers: [], lastProposalId: 0, nextFromIndex: null };
  }
  const transfers: DaoProposal[] = [];
  let cursor = fromIndex ?? lastProposalId;
  let iterations = 0;
  while (transfers.length < limit && cursor > 0 && iterations < PROPOSAL_FETCH_MAX_ITERATIONS) {
    const startIndex = Math.max(0, cursor - PROPOSAL_FETCH_PAGE_SIZE);
    const fetched = await getProposals(db, orgAccountId, startIndex, cursor - startIndex);
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

export function createProposalsService(db: Database, agency: AgencyService) {
  return {
    list: (context: Record<string, unknown>, input: { fromIndex?: number; limit: number }) =>
      Effect.gen(function* () {
        const orgAccountId = yield* agency.getDaoAccountId(context);
        const isContributor = ["admin", "contributor"].includes(
          (context as any).organization?.member?.role ?? "",
        );

        try {
          const { transfers, lastProposalId, nextFromIndex } = yield* Effect.promise(() =>
            fetchTransferProposals(db, orgAccountId, input.fromIndex, input.limit),
          );

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
          const orgProjectsById = yield* Effect.promise(() =>
            agency.fetchOrgProjectsById(orgAccountId, context),
          );

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
                    .where(inArray(billings.proposalId, proposalIdStrs)),
                )
              : [];

          const mappingByProposal = new Map(
            localBillings
              .filter((b) => orgProjectsById.has(b.projectId))
              .map((b) => [b.proposalId, b]),
          );

          const data = transfers.map((p) => {
            const m = mappingByProposal.get(String(p.id));
            const project = m ? orgProjectsById.get(m.projectId) : undefined;
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
        } catch (err) {
          if (isContributor) throw err;
          return { data: [], lastProposalId: 0, nextFromIndex: null };
        }
      }),

    getPublicSummary: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* agency.getDaoAccountId(context);
        try {
          const lastProposalId = yield* Effect.promise(() => getLastProposalId(orgAccountId));
          if (lastProposalId === 0) return summarizeProposals([], 0);
          const pageSize = Math.min(100, lastProposalId);
          const recent = yield* Effect.promise(() =>
            getProposals(db, orgAccountId, Math.max(0, lastProposalId - pageSize), pageSize),
          );
          return summarizeProposals(recent, lastProposalId);
        } catch {
          return summarizeProposals([], 0);
        }
      }),
  };
}

export type ProposalsService = ReturnType<typeof createProposalsService>;
