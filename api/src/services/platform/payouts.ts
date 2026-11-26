import { type AnyColumn, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db";
import {
  agentPayouts,
  type PlatformPayoutRow,
  platformAgents,
  platformPayouts,
} from "../../db/schema";
import type { FundingCheck } from "../payouts/service";
import type { AgentPayoutView } from "../work-orders/service";
import { badRequest, type PlatformAgents } from "./agents";
import { ASSETS, type OwnerOutput, type OwnerResult, type PlatformApp } from "./client";
import type { PayoutRoute } from "./terms";

const UNAVAILABLE = "Platform access isn't turned on for this server";

const WNEAR = ASSETS.wNEAR;
const WNEAR_DECIMALS = 24;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNSETTLED = ["sending", "processing", "held", "unknown"];

type Overview = OwnerOutput<"overview">;
type PayoutAnswer = OwnerOutput<"payouts/request">;

export function noUnsettledPlatformPayout(compensationRequestId: AnyColumn) {
  return sql`not exists (select 1 from ${platformPayouts} where ${platformPayouts.compensationRequestId} = ${compensationRequestId} and not (${platformPayouts.state} = 'refused' or (${platformPayouts.state} = 'failed' and ${platformPayouts.neverExecuted})))`;
}

function nearOf(atomic: bigint, digits = 4) {
  const unit = 10n ** BigInt(WNEAR_DECIMALS);
  const scale = 10n ** BigInt(digits);
  const scaled = (atomic * scale) / unit;
  const fraction = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return fraction ? `${scaled / scale}.${fraction}` : `${scaled / scale}`;
}

function provenUnsent(row: PlatformPayoutRow) {
  return row.state === "refused" || (row.state === "failed" && row.neverExecuted);
}

export function payoutView(row: PlatformPayoutRow): AgentPayoutView {
  const status: AgentPayoutView["status"] =
    row.state === "succeeded"
      ? "paid"
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

  async function routeOf(organizationId: string): Promise<PayoutRoute> {
    const [row] = await db
      .select({ route: platformAgents.payoutRoute })
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    return deps.app && row?.route === "platform" ? "platform" : "legacy";
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
    if (policy.owner_approval)
      return refuse("owner_approval", "The rules require a vote per payout");
    const live = overview.grants.some(
      (g) => g.label === "payout" && !g.revoked_at && Date.parse(g.expires_at) > now().getTime(),
    );
    if (!live) return refuse("no_grant", "MultiAgency's payout permission is missing or expired");
    const agreed = policy.destinations.list.some(
      (d) => d.action === "withdraw" && d.chain === "near" && d.address === payee.toLowerCase(),
    );
    if (!agreed) {
      return refuse(
        "payee_not_allowed",
        `The signed rules don't allow paying ${payee} yet: sign the updated rules`,
      );
    }
    if (policy.assets !== "any" && !policy.assets.includes(WNEAR)) {
      return refuse("asset_not_allowed", "The rules don't allow paying in NEAR");
    }
    if (amountAtomic == null) return { ready: true, code: null, reason: null };
    const amount = BigInt(amountAtomic);
    const cap = policy.limits.per_transaction?.[WNEAR];
    if (cap !== undefined && amount > BigInt(cap)) {
      return refuse(
        "over_cap",
        `${nearOf(amount)} NEAR is over the ${nearOf(BigInt(cap))} NEAR cap per payout`,
      );
    }
    const held = overview.book.find((h) => h.asset === WNEAR);
    const monthly = overview.policy.usage?.budget.monthly;
    const price = held?.price ?? null;
    if (monthly?.remaining_usd != null && price != null) {
      const amountUsd = Number(nearOf(amount, 6)) * price;
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
        `The agent holds ${nearOf(balance)} NEAR; this payout needs ${nearOf(amount)} NEAR`,
      );
    }
    return { ready: true, code: null, reason: null };
  }

  async function fundingCheck(
    organizationId: string,
    needs: { near: bigint; priceUsd: string | null },
  ): Promise<FundingCheck | null> {
    const overview = await overviewOf(organizationId);
    if (typeof overview === "string") return null;
    const held = overview.book.find((h) => h.asset === WNEAR);
    const balance = held ? held.confidential + held.public : null;
    const step = 10n ** BigInt(WNEAR_DECIMALS - 2);
    const missing = balance !== null && needs.near > balance ? needs.near - balance : 0n;
    const shortfall = ((missing + step - 1n) / step) * step;
    const price = needs.priceUsd != null ? Number(needs.priceUsd) : (held?.price ?? null);
    const neededUsd =
      price != null && Number.isFinite(price) ? Number(nearOf(needs.near, 6)) * price : null;
    const monthly = overview.policy.usage?.budget.monthly ?? null;
    const monthlyBudgetUsd =
      monthly?.limit_usd ?? overview.policy.policy?.budget.monthly_usd ?? null;
    const budgetTooLow =
      neededUsd !== null && monthlyBudgetUsd !== null && neededUsd > Number(monthlyBudgetUsd);
    return {
      balanceNear: balance === null ? null : nearOf(balance),
      neededNear: nearOf(needs.near),
      shortfallNear: nearOf(shortfall),
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
    return {
      state: value.state === "not_found" ? "sending" : value.state,
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
      delivery: { chain: row.chain },
      recipient: row.recipient,
      amount: row.amount,
      expectedPolicy: { revision: row.expectedRevision, digest: row.expectedDigest },
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
    if (failure.kind === "refused" || failure.kind === "session" || failure.kind === "forbidden") {
      await deps.agents.accessFailed(row.organizationId, consentId, failure);
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
    input: { requestId: string; recipient: string; amount: string },
  ): Promise<AgentPayoutView> {
    const connected = await payoutConnection(organizationId);
    if (!connected?.connection.scopes.includes("payout")) {
      throw badRequest("This Organization's platform agent can't be asked to pay");
    }
    const [last] = await attemptsOf(input.requestId);
    if (last && !provenUnsent(last)) return payoutView(last);
    const attempt = (last?.attempt ?? 0) + 1;
    const requestId = `${input.requestId}-${attempt}`;
    if (!REQUEST_ID.test(requestId)) throw badRequest(`${requestId} can't be a platform payout ID`);
    const overview = await connected.calls.call("overview");
    if (!overview.ok || overview.value.policy.revision === null || !overview.value.digest) {
      throw badRequest("The agent's rules can't be read to pay against them. Try again shortly.");
    }
    await db.insert(platformPayouts).values({
      requestId,
      compensationRequestId: input.requestId,
      attempt,
      organizationId,
      agent: connected.connection.agent,
      asset: WNEAR,
      chain: "near",
      recipient: input.recipient.toLowerCase(),
      amount: input.amount,
      expectedRevision: overview.value.policy.revision,
      expectedDigest: overview.value.digest,
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

  async function owns(compensationRequestId: string) {
    return (await attemptsOf(compensationRequestId)).length > 0;
  }

  async function ensurePayees(organizationId: string) {
    const missing = await deps.pendingPayees(organizationId);
    return missing.length === 0
      ? { ok: true, reason: null }
      : { ok: false, reason: `Sign the updated rules to allow paying ${missing.join(", ")}` };
  }

  async function unsettled(organizationId: string) {
    const rows = await db
      .select()
      .from(platformPayouts)
      .where(eq(platformPayouts.organizationId, organizationId));
    return rows.filter((row) => row.state !== "succeeded" && !provenUnsent(row)).length;
  }

  async function isPlatformPayout(id: string) {
    const [row] = await db
      .select({ requestId: platformPayouts.requestId })
      .from(platformPayouts)
      .where(eq(platformPayouts.requestId, id));
    return !!row;
  }

  async function legacyUnsettled(organizationId: string) {
    const rows = await db
      .select({ status: agentPayouts.status, provenUnsent: agentPayouts.provenUnsent })
      .from(agentPayouts)
      .where(eq(agentPayouts.organizationId, organizationId));
    return rows.filter(
      (row) =>
        row.status !== "paid" &&
        row.status !== "refused" &&
        !(row.status === "failed" && row.provenUnsent),
    ).length;
  }

  async function setRoute(organizationId: string, route: PayoutRoute) {
    if (!deps.app) throw badRequest(UNAVAILABLE);
    if (route === "platform") {
      const connection = await deps.agents.connection(organizationId);
      if (!connection?.scopes.includes("payout")) {
        throw badRequest(
          "The owner signs a consent that includes payouts before payouts can switch",
        );
      }
      const open = await legacyUnsettled(organizationId);
      if (open > 0) {
        throw badRequest(
          `${open} payout${open === 1 ? "" : "s"} on the current payout agent aren't settled yet. Let them finish first.`,
        );
      }
    } else {
      const open = await unsettled(organizationId);
      if (open > 0) {
        throw badRequest(
          `${open} platform payout${open === 1 ? "" : "s"} aren't settled yet. Let them finish first.`,
        );
      }
    }
    const [updated] = await db
      .update(platformAgents)
      .set({ payoutRoute: route, updatedAt: now() })
      .where(eq(platformAgents.organizationId, organizationId))
      .returning({ route: platformAgents.payoutRoute });
    if (!updated) throw badRequest("This Organization has no platform agent");
    return { organizationId, route: updated.route };
  }

  return {
    routeOf,
    setRoute,
    isPlatformPayout,
    readiness,
    fundingCheck,
    send,
    refresh,
    latest,
    owns,
    ensurePayees,
    unsettled,
  };
}

export type PlatformPayouts = ReturnType<typeof createPlatformPayouts>;
