import { type AnyColumn, and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db";
import {
  compensationRequests,
  type PlatformPayoutRow,
  platformAgents,
  platformPayouts,
  workOrders,
} from "../../db/schema";
import { atomicToDecimal, atomicToNear, tokenOfAsset, topUpFor } from "../payouts/amounts";
import type { FundingCheck } from "../payouts/history";
import type { AgentPayoutView } from "../work-orders/service";
import { badRequest, type PlatformAgents } from "./agents";
import { ASSETS, type OwnerOutput, type OwnerResult, type PlatformApp } from "./client";
import { PAYOUT_ASSET_TERMS, type PayoutAssetTerms } from "./rules";

const WNEAR = ASSETS.wNEAR;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNSETTLED = ["sending", "processing", "held", "unknown"];

type Overview = OwnerOutput<"overview">;
type PayoutAnswer = OwnerOutput<"payouts/request">;

export function noUnsettledPlatformPayout(compensationRequestId: AnyColumn) {
  return sql`not exists (select 1 from ${platformPayouts} where ${platformPayouts.compensationRequestId} = ${compensationRequestId} and not (${platformPayouts.state} in ('refused', 'rejected') or (${platformPayouts.state} = 'failed' and ${platformPayouts.neverExecuted})))`;
}

function retryable(row: PlatformPayoutRow) {
  return row.state === "refused" || (row.state === "failed" && row.neverExecuted);
}

function provenUnsent(row: PlatformPayoutRow) {
  return retryable(row) || row.state === "rejected";
}

const OWNER_REJECTIONS = new Set(["rejected_by_owner", "rejected"]);

export type PayoutTerms = {
  compensationRequestId: string;
  workOrderId: string;
  workOrderTitle: string;
  approvedAmount: string | null;
  tokenId: string;
  priceUsd: string | null;
};

export function platformPayoutTerms(db: Database) {
  return async (organizationId: string, correlationIds: string[]) => {
    if (correlationIds.length === 0) return new Map<string, PayoutTerms>();
    const rows = await db
      .select({
        correlationId: platformPayouts.correlationId,
        compensationRequestId: platformPayouts.compensationRequestId,
        workOrderId: workOrders.id,
        workOrderTitle: workOrders.title,
        approvedAmount: compensationRequests.approvedAmount,
        tokenId: workOrders.tokenId,
        priceUsd: compensationRequests.priceUsd,
      })
      .from(platformPayouts)
      .innerJoin(
        compensationRequests,
        eq(compensationRequests.id, platformPayouts.compensationRequestId),
      )
      .innerJoin(workOrders, eq(workOrders.id, compensationRequests.workOrderId))
      .where(
        and(
          eq(platformPayouts.organizationId, organizationId),
          inArray(platformPayouts.correlationId, correlationIds),
        ),
      );
    return new Map(
      rows.flatMap(({ correlationId, ...terms }) =>
        correlationId ? [[correlationId, terms] as const] : [],
      ),
    );
  };
}

export function payoutView(row: PlatformPayoutRow): AgentPayoutView {
  const status: AgentPayoutView["status"] =
    row.state === "succeeded"
      ? "paid"
      : row.state === "rejected"
        ? "rejected"
        : row.state === "refused"
          ? "refused"
          : row.state === "failed"
            ? row.neverExecuted
              ? "failed"
              : "needs_review"
            : row.state === "unknown"
              ? "uncertain"
              : row.state === "sending"
                ? "sending"
                : row.state === "conflict"
                  ? "needs_review"
                  : "processing";
  const reason =
    row.state === "held"
      ? "Waiting for the agent owner's vote on the MultiAgency platform"
      : row.state === "rejected"
        ? "The agent's owner rejected this payout"
        : row.state === "unknown"
          ? "The platform hasn't proven the outcome yet; nothing is sent again meanwhile"
          : row.state === "conflict"
            ? "The platform recorded other terms under this payout's ID; a person checks it"
            : (row.code ?? row.failureCode ?? null);
  return {
    id: row.requestId,
    organizationId: row.organizationId,
    requestId: row.compensationRequestId,
    status,
    amount: row.amount,
    correlationId: row.correlationId,
    txHash: null,
    txUrl: null,
    reason,
    provenUnsent: provenUnsent(row),
    assetId: row.asset,
    createdAt: row.createdAt,
  };
}

export function createPlatformPayouts(deps: {
  db: Database;
  app: PlatformApp | null;
  agents: PlatformAgents;
  pendingPayees: (organizationId: string) => Promise<string[]>;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function termsOf(organizationId: string): Promise<PayoutAssetTerms> {
    const [row] = await db
      .select({ asset: platformAgents.payoutAsset })
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    return PAYOUT_ASSET_TERMS[row?.asset ?? "wnear"];
  }

  async function configured(organizationId: string) {
    if (!deps.app) return false;
    return !!(await deps.agents.connection(organizationId))?.scopes.includes("payout");
  }

  async function payoutToken(organizationId: string) {
    return tokenOfAsset((await termsOf(organizationId)).id);
  }

  async function payoutConnection(organizationId: string) {
    const connection = await deps.agents.connection(organizationId);
    if (!deps.app || !connection) return null;
    return { connection, calls: deps.app.agent(organizationId, connection.agent) };
  }

  async function overviewOf(organizationId: string): Promise<Overview | string> {
    const connected = await payoutConnection(organizationId);
    if (!connected) return "No connected platform agent";
    if (!connected.connection.scopes.includes("payout")) {
      return "The owner's consent doesn't include payouts: sign a new one with payouts";
    }
    const overview = await connected.calls.call("overview");
    if (overview.ok) return overview.value;
    await deps.agents.accessFailed(organizationId, connected.connection.consentId, overview);
    return `The MultiAgency platform couldn't be read (${overview.kind})`;
  }

  async function readiness(
    organizationId: string,
    payee: string,
    amountAtomic?: string | bigint | null,
  ) {
    const refuse = (code: string, reason: string) => ({ ready: false, code, reason });
    const overview = await overviewOf(organizationId);
    if (typeof overview === "string") return refuse("unreachable", overview);
    const policy = overview.policy.policy;
    if (!policy || overview.policy.status !== "APPLIED") {
      return refuse("not_applied", "The agent's rules aren't applied");
    }
    if (policy.frozen) return refuse("frozen", "Payouts are frozen");
    if (overview.notInForce)
      return refuse("not_applied", `The agent's rules aren't in force: ${overview.notInForce}`);
    const live = overview.grants.some(
      (g) => g.label === "payout" && !g.revoked_at && Date.parse(g.expires_at) > now().getTime(),
    );
    if (!live) return refuse("no_grant", "MultiAgency's payout permission is missing or expired");
    const terms = await termsOf(organizationId);
    const units = (value: bigint) => `${atomicToDecimal(value, terms.decimals)} ${terms.symbol}`;
    const agreed = policy.destinations.list.some(
      (d) =>
        d.address === payee.toLowerCase() &&
        (terms.delivery === "intents"
          ? d.action === "transfer"
          : d.action === "withdraw" && d.chain === terms.delivery),
    );
    if (!agreed) {
      return refuse(
        "payee_not_allowed",
        `The signed rules don't allow paying ${payee} yet: sign the updated rules`,
      );
    }
    if (policy.assets !== "any" && !policy.assets.includes(terms.id)) {
      return refuse("asset_not_allowed", `The rules don't allow paying in ${terms.symbol}`);
    }
    if (amountAtomic == null) return { ready: true, code: null, reason: null };
    const amount = BigInt(amountAtomic);
    const cap = policy.limits.per_transaction?.[terms.id];
    if (cap !== undefined && amount > BigInt(cap)) {
      return refuse(
        "over_cap",
        `${units(amount)} is over the ${units(BigInt(cap))} cap per payout`,
      );
    }
    const held = overview.book.find((h) => h.asset === terms.id);
    const monthly = overview.policy.usage?.budget.monthly;
    const price = held?.price ?? null;
    if (monthly?.remaining_usd != null && price != null) {
      const amountUsd = Number(atomicToDecimal(amount, terms.decimals, 6)) * price;
      if (amountUsd > Number(monthly.remaining_usd)) {
        return refuse(
          "over_monthly_budget",
          `≈$${amountUsd.toFixed(2)} is more than the $${monthly.remaining_usd} left in this month's budget`,
        );
      }
    }
    const balance = held ? held.confidential + held.public : null;
    if (balance !== null && balance < amount) {
      return refuse(
        "insufficient_balance",
        `The agent holds ${units(balance)}; this payout needs ${units(amount)}`,
      );
    }
    return { ready: true, code: null, reason: null };
  }

  async function fundingCheck(
    organizationId: string,
    needs: { near: bigint; priceUsd: string | null },
  ): Promise<FundingCheck | null> {
    if ((await termsOf(organizationId)).id !== WNEAR) return null;
    const overview = await overviewOf(organizationId);
    if (typeof overview === "string") return null;
    const held = overview.book.find((h) => h.asset === WNEAR);
    const balance = held ? held.confidential + held.public : null;
    const shortfall = balance === null ? 0n : topUpFor(needs.near, balance);
    const price = needs.priceUsd != null ? Number(needs.priceUsd) : (held?.price ?? null);
    const neededUsd =
      price != null && Number.isFinite(price) ? Number(atomicToNear(needs.near, 6)) * price : null;
    const monthly = overview.policy.usage?.budget.monthly ?? null;
    const monthlyBudgetUsd =
      monthly?.limit_usd ?? overview.policy.policy?.budget.monthly_usd ?? null;
    const budgetTooLow =
      neededUsd !== null && monthlyBudgetUsd !== null && neededUsd > Number(monthlyBudgetUsd);
    return {
      balanceNear: balance === null ? null : atomicToNear(balance),
      neededNear: atomicToNear(needs.near),
      shortfallNear: atomicToNear(shortfall),
      monthlyBudgetUsd,
      monthlyRemainingUsd: monthly?.remaining_usd ?? null,
      monthlyNeededUsd: neededUsd === null ? null : neededUsd.toFixed(2),
      suggestedBudgetUsd: budgetTooLow && neededUsd !== null ? String(Math.ceil(neededUsd)) : null,
      budgetTooLow,
      lowBalance: shortfall > 0n,
    };
  }

  async function attemptsOf(compensationRequestId: string) {
    return db
      .select()
      .from(platformPayouts)
      .where(eq(platformPayouts.compensationRequestId, compensationRequestId))
      .orderBy(desc(platformPayouts.attempt));
  }

  async function record(requestId: string) {
    const [row] = await db
      .select()
      .from(platformPayouts)
      .where(eq(platformPayouts.requestId, requestId));
    if (!row) throw badRequest(`No platform payout ${requestId}`);
    return row;
  }

  async function settle(row: PlatformPayoutRow, patch: Partial<PlatformPayoutRow>) {
    await db
      .update(platformPayouts)
      .set({ ...patch, updatedAt: now() })
      .where(eq(platformPayouts.requestId, row.requestId));
    return record(row.requestId);
  }

  function answered(value: PayoutAnswer): Partial<PlatformPayoutRow> {
    const rejected =
      value.state === "failed" &&
      value.neverExecuted === true &&
      OWNER_REJECTIONS.has(value.failureCode ?? "");
    return {
      state: rejected ? "rejected" : value.state === "not_found" ? "sending" : value.state,
      status: value.status,
      code: value.code,
      failureCode: value.failureCode ?? null,
      neverExecuted: value.neverExecuted === true,
      correlationId: value.correlationId,
    };
  }

  async function ask(row: PlatformPayoutRow): Promise<PlatformPayoutRow> {
    const connected = await payoutConnection(row.organizationId);
    if (!connected) return row;
    const result = await connected.calls.call("payouts/request", {
      requestId: row.requestId,
      asset: row.asset,
      delivery: row.chain === "intents" ? "intents" : { chain: row.chain },
      recipient: row.recipient,
      amount: row.amount,
      expectedPolicy: { revision: row.expectedRevision, digest: row.expectedDigest },
      ...(row.allowDuplicateHeld ? { allowDuplicateHeld: true as const } : {}),
    });
    if (result.ok) return settle(row, answered(result.value));
    return afterFailure(row, connected.connection.consentId, result);
  }

  async function afterFailure(
    row: PlatformPayoutRow,
    consentId: string,
    failure: Extract<OwnerResult<unknown>, { ok: false }>,
  ): Promise<PlatformPayoutRow> {
    if (failure.kind === "refused" && failure.code === "request_conflict") {
      return settle(row, { state: "conflict", code: failure.code });
    }
    if (failure.kind === "refused" && failure.code === "recipient_unchecked") return row;
    if (failure.kind === "session" || failure.kind === "forbidden") {
      await deps.agents.accessFailed(row.organizationId, consentId, failure);
      return row;
    }
    if (failure.kind === "refused") {
      return settle(row, { state: "refused", code: failure.code ?? failure.kind });
    }
    return status(row);
  }

  async function status(row: PlatformPayoutRow): Promise<PlatformPayoutRow> {
    const connected = await payoutConnection(row.organizationId);
    if (!connected) return row;
    const read = await connected.calls.call("payouts/status", { requestId: row.requestId });
    if (!read.ok) return row;
    if (read.value.state === "not_found" && row.state === "sending") return row;
    return settle(row, answered(read.value));
  }

  async function send(
    organizationId: string,
    input: { requestId: string; recipient: string; amount: string; tokenId: string },
  ): Promise<AgentPayoutView> {
    const connected = await payoutConnection(organizationId);
    if (!connected?.connection.scopes.includes("payout")) {
      throw badRequest("This Organization's platform agent can't be asked to pay");
    }
    const terms = await termsOf(organizationId);
    const [last] = await attemptsOf(input.requestId);
    if (last && !retryable(last)) return payoutView(last);
    if (tokenOfAsset(terms.id) !== input.tokenId) {
      throw badRequest(
        `The agent now pays in ${terms.symbol}; this payout is priced again on the next try`,
      );
    }
    const attempt = (last?.attempt ?? 0) + 1;
    const requestId = `${input.requestId}-${attempt}`;
    if (!REQUEST_ID.test(requestId)) throw badRequest(`${requestId} can't be a platform payout ID`);
    const overview = await connected.calls.call("overview");
    if (!overview.ok || overview.value.policy.revision === null || !overview.value.digest) {
      throw badRequest("The agent's rules can't be read to pay against them. Try again shortly.");
    }
    await db.insert(platformPayouts).values({
      createdAt: now(),
      updatedAt: now(),
      requestId,
      compensationRequestId: input.requestId,
      attempt,
      organizationId,
      agent: connected.connection.agent,
      asset: terms.id,
      chain: terms.delivery,
      recipient: input.recipient.toLowerCase(),
      amount: input.amount,
      expectedRevision: overview.value.policy.revision,
      expectedDigest: overview.value.digest,
      allowDuplicateHeld: true,
      state: "sending",
    });
    return payoutView(await ask(await record(requestId)));
  }

  async function refresh(payout: AgentPayoutView): Promise<AgentPayoutView> {
    const row = await record(payout.id);
    if (!UNSETTLED.includes(row.state)) return payoutView(row);
    const read = await status(row);
    return payoutView(read.state === "sending" ? await ask(read) : read);
  }

  async function latest(compensationRequestId: string) {
    const [last] = await attemptsOf(compensationRequestId);
    return last ? payoutView(last) : null;
  }

  async function ensurePayees(organizationId: string) {
    const missing = await deps.pendingPayees(organizationId);
    return missing.length === 0
      ? { ok: true, reason: null }
      : { ok: false, reason: `Sign the updated rules to allow paying ${missing.join(", ")}` };
  }

  async function isPlatformPayout(id: string) {
    const [row] = await db
      .select({ requestId: platformPayouts.requestId })
      .from(platformPayouts)
      .where(eq(platformPayouts.requestId, id));
    return !!row;
  }

  return {
    configured,
    payoutToken,
    isPlatformPayout,
    readiness,
    fundingCheck,
    send,
    refresh,
    latest,
    ensurePayees,
  };
}

export type PlatformPayouts = ReturnType<typeof createPlatformPayouts>;
