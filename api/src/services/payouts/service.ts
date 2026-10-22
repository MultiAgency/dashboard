import {
  AgentApiError,
  AgentApiRequestError,
  AgentApiResponseTooLargeError,
  type BalancesView,
  createGrantCredential,
  type GenerateIntentResponse,
  type Policy,
  type PolicyView,
  type StatusResponse,
} from "@near-intents-agent-api/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../../db";
import {
  type AgentPayoutRow,
  agentPayouts,
  type PAYOUT_ACTIONS,
  type PayoutAgentRow,
  payoutAgents,
  payoutIntents,
  workOrders,
} from "../../db/schema";
import { open, seal } from "./crypto";
import {
  allowsPayee,
  atomicToNear,
  buildPolicy,
  diffPolicy,
  NEAR_ASSET,
  nearToAtomic,
  payeesOf,
} from "./policy";

export type PayoutAction = (typeof PAYOUT_ACTIONS)[number];

export type AgentApiPort = {
  generateIntent(
    request: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<GenerateIntentResponse>;
  submitIntent(request: {
    type: string;
    correlation_id: string;
    signed_data: unknown;
  }): Promise<StatusResponse>;
  getStatus(correlationId: string, options?: { waitMs?: number }): Promise<StatusResponse>;
  getPolicy(agentId: string): Promise<PolicyView>;
  getBalances(agentId: string, query?: { asset?: string }): Promise<BalancesView>;
  deposit(
    agentId: string,
    request: { origin_asset: string; destination_asset: string },
    options?: { idempotencyKey?: string },
  ): Promise<StatusResponse>;
  withdraw(
    agentId: string,
    request: { asset: string; amount: string; chain: string; recipient: string },
    options: { idempotencyKey: string },
  ): Promise<StatusResponse>;
  forGrant(grantToken: string): AgentApiPort;
};

const AGENT_NAME = "MultiAgency payouts";
const GRANT_LABEL = "MultiAgency work-order payouts";
const GRANT_DAYS = 90;
const PENDING_INTENT = new Set(["PENDING_SIGNATURE", "QUEUED", "PROCESSING", "PENDING_APPROVAL"]);
const OPEN_PAYOUT: readonly AgentPayoutRow["status"][] = [
  "sending",
  "queued",
  "processing",
  "uncertain",
];
const PROVEN_REFUSALS = new Set([
  "validation_failed",
  "invalid_json",
  "idempotency_key_required",
  "agent_grant_required",
  "policy_action_denied",
  "policy_destination_denied",
  "policy_schedule_denied",
  "spend_budget_exceeded",
  "policy_denied",
  "policy_not_ready",
  "wallet_frozen",
  "insufficient_balance",
  "amount_too_low",
  "route_unavailable",
  "quote_unavailable",
  "spend_price_unavailable",
  "wallet_busy",
  "provider_rate_limited",
  "unsupported_chain",
  "unsupported_token",
  "invalid_address",
  "agent_not_bound",
  "agent_archived",
  "agent_deleted",
]);
const DECIMAL = /^\d+(\.\d+)?$/;

const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });

const errorText = (error: unknown) => {
  if (error instanceof AgentApiError)
    return `${error.title || error.code}${error.detail ? `: ${error.detail}` : ""}`;
  return error instanceof Error ? error.message : String(error);
};

function isRetryable(error: unknown): boolean {
  if (error instanceof AgentApiRequestError || error instanceof AgentApiResponseTooLargeError)
    return true;
  return (
    error instanceof AgentApiError &&
    (error.retryable || error.status >= 500 || error.status === 429)
  );
}

function textOf(details: unknown, key: string): string | null {
  const value = (details as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : null;
}

export function createPayoutAgents(deps: {
  db: Database;
  api: AgentApiPort | null;
  secretKey: string | null;
  payees: (organizationId: string) => Promise<string[]>;
  fullAccessKeys?: (accountId: string) => Promise<string[]>;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const available = deps.api !== null && !!deps.secretKey;
  const unavailableReason =
    "Automatic payouts aren't set up on this server: set NEAR_INTENTS_AGENT_API_KEY and PAYOUTS_SECRET_KEY.";

  function api(): AgentApiPort {
    if (!deps.api || !deps.secretKey) throw badRequest("PAYOUTS_UNAVAILABLE", unavailableReason);
    return deps.api;
  }

  async function settings(organizationId: string): Promise<PayoutAgentRow | null> {
    const [row] = await db
      .select()
      .from(payoutAgents)
      .where(eq(payoutAgents.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  async function update(organizationId: string, patch: Partial<PayoutAgentRow>) {
    await db
      .update(payoutAgents)
      .set({ ...patch, updatedAt: now() })
      .where(eq(payoutAgents.organizationId, organizationId));
  }

  function grantOf(row: PayoutAgentRow | null): string | null {
    if (!row?.grantTokenEnc || !deps.secretKey) return null;
    if (row.grantExpiresAt && row.grantExpiresAt.getTime() <= now().getTime()) return null;
    try {
      return open(row.grantTokenEnc, deps.secretKey);
    } catch {
      return null;
    }
  }

  async function wantedPolicy(row: PayoutAgentRow, frozen: boolean): Promise<Policy> {
    return buildPolicy({
      payees: await deps.payees(row.organizationId),
      maxPayoutNear: row.maxPayoutNear,
      monthlyBudgetUsd: row.monthlyBudgetUsd,
      frozen,
    });
  }

  async function livePolicy(row: PayoutAgentRow) {
    if (!row.agentId) return null;
    return api().getPolicy(row.agentId);
  }

  async function balanceOf(agentId: string) {
    try {
      const view = await api().getBalances(agentId, { asset: NEAR_ASSET });
      const entry = view.balances.find((b) => b.asset_id === NEAR_ASSET);
      const raw = BigInt(entry?.balance_raw ?? "0");
      const near = atomicToNear(raw);
      const usd = entry?.price != null ? (Number(near) * entry.price).toFixed(2) : null;
      return { near, usd };
    } catch {
      return null;
    }
  }

  async function view(organizationId: string) {
    const row = await settings(organizationId);
    const base = {
      available,
      unavailableReason: available ? null : unavailableReason,
      settings: row
        ? {
            ownerAccountId: row.ownerAccountId,
            monthlyBudgetUsd: row.monthlyBudgetUsd,
            maxPayoutNear: row.maxPayoutNear,
          }
        : null,
      agentId: row?.agentId ?? null,
      grantExpiresAt: row?.grantExpiresAt?.toISOString() ?? null,
      grantValid: grantOf(row) !== null,
    };
    if (!available || !row?.agentId) {
      return {
        ...base,
        policy: null,
        changes: [] as string[],
        ready: false,
        balance: null,
        blockers: !available
          ? [unavailableReason]
          : !row
            ? ["Save the payout settings"]
            : ["Create the payout agent with your wallet"],
        error: null as string | null,
      };
    }
    try {
      const [current, balance] = await Promise.all([livePolicy(row), balanceOf(row.agentId)]);
      const signed = current?.policy ?? null;
      const wanted = await wantedPolicy(row, signed?.frozen ?? false);
      const blockers: string[] = [];
      if (!signed || current?.status !== "APPLIED")
        blockers.push("The agent's rules aren't applied yet");
      if (signed?.frozen) blockers.push("Payouts are frozen");
      if (signed?.owner_approval)
        blockers.push("The signed rules still require your vote per payout");
      if (!base.grantValid)
        blockers.push("Issue MultiAgency's payout permission (grant) with your wallet");
      return {
        ...base,
        policy: signed
          ? {
              status: current?.status ?? "NONE",
              frozen: signed.frozen,
              ownerApproval: signed.owner_approval,
              payees: payeesOf(signed),
              monthlyLimitUsd: current?.usage.budget.monthly.limit_usd ?? null,
              monthlySpentUsd: current?.usage.budget.monthly.spent_usd ?? null,
              monthlyRemainingUsd: current?.usage.budget.monthly.remaining_usd ?? null,
            }
          : null,
        changes: signed ? diffPolicy(signed, wanted) : [],
        balance,
        ready: blockers.length === 0,
        blockers,
        error: null as string | null,
      };
    } catch (error) {
      return {
        ...base,
        policy: null,
        changes: [] as string[],
        balance: null,
        ready: false,
        blockers: ["The Agent API couldn't be reached"],
        error: errorText(error),
      };
    }
  }

  async function prepareRequest(
    row: PayoutAgentRow,
    action: PayoutAction,
    publicKey?: string | null,
  ) {
    if (action === "create_agent") {
      if (row.agentId) throw badRequest("AGENT_EXISTS", "The payout agent already exists");
      if (!publicKey && deps.fullAccessKeys) {
        const keys = await deps.fullAccessKeys(row.ownerAccountId).catch((error: unknown) => {
          throw badRequest(
            "NEAR_RPC",
            `Couldn't read ${row.ownerAccountId}'s keys from NEAR: ${errorText(error)}`,
          );
        });
        if (keys.length !== 1) {
          throw badRequest(
            "PUBLIC_KEY_REQUIRED",
            keys.length === 0
              ? `${row.ownerAccountId} has no full-access key on NEAR`
              : `${row.ownerAccountId} has ${keys.length} full-access keys; use a wallet that reports which one it signs with`,
          );
        }
        publicKey = keys[0];
      }
      if (!publicKey || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,}$/.test(publicKey)) {
        throw badRequest("PUBLIC_KEY_REQUIRED", "Connect the owner's wallet first");
      }
      return {
        request: {
          type: "agent_create",
          name: AGENT_NAME,
          external_user_id: `multiagency:${row.organizationId}`,
          owner: { type: "near", account_id: row.ownerAccountId, public_key: publicKey },
          policy: await wantedPolicy(row, false),
        },
        grant: null,
      };
    }
    const agentId = row.agentId;
    if (!agentId) throw badRequest("AGENT_MISSING", "Create the payout agent first");
    switch (action) {
      case "issue_grant": {
        const credential = createGrantCredential();
        const expiresAt = new Date(now().getTime() + GRANT_DAYS * 86_400_000);
        return {
          request: {
            type: "grant_issue",
            agent_id: agentId,
            label: GRANT_LABEL,
            credential: credential.commitment,
            expires_at: expiresAt.toISOString(),
          },
          grant: { token: credential.token, expiresAt },
        };
      }
      case "sync_policy": {
        const current = await api().getPolicy(agentId);
        if (current.revision === null) {
          throw badRequest("POLICY_NOT_READY", "The agent's first rules are still being applied");
        }
        return {
          request: {
            type: "policy_update",
            agent_id: agentId,
            policy: await wantedPolicy(row, current.policy?.frozen ?? false),
            expected_revision: current.revision,
          },
          grant: null,
        };
      }
      case "freeze":
        return { request: { type: "agent_freeze", agent_id: agentId }, grant: null };
      case "unfreeze":
        return { request: { type: "agent_unfreeze", agent_id: agentId }, grant: null };
    }
  }

  async function settleIntent(
    organizationId: string,
    correlationId: string,
    status: StatusResponse,
  ) {
    const [intent] = await db
      .select()
      .from(payoutIntents)
      .where(eq(payoutIntents.correlationId, correlationId))
      .limit(1);
    if (!intent) return;
    await db
      .update(payoutIntents)
      .set({ status: status.status, failureCode: status.failure_code, updatedAt: now() })
      .where(eq(payoutIntents.correlationId, correlationId));
    if (status.status !== "SUCCESS") return;
    if (intent.action === "create_agent") {
      const agentId = textOf(status.details, "agent_id") ?? status.agent_id ?? intent.agentId;
      if (agentId) await update(organizationId, { agentId });
    }
    if (intent.action === "issue_grant" && intent.grantTokenEnc) {
      await update(organizationId, {
        grantTokenEnc: intent.grantTokenEnc,
        grantExpiresAt: intent.grantExpiresAt,
      });
    }
  }

  function applyStatus(status: Pick<StatusResponse, "status" | "failure_code" | "details">) {
    const details = status.details;
    switch (status.status) {
      case "SUCCESS": {
        const txHash = textOf(details, "destination_tx_hash") ?? textOf(details, "tx_hash");
        const intentHash = textOf(details, "intent_hash");
        return {
          status: "paid" as const,
          reason: null,
          txHash: txHash ?? intentHash,
          txUrl: txHash
            ? `https://nearblocks.io/txns/${txHash}`
            : intentHash
              ? `https://explorer.near-intents.org/transactions/${intentHash}`
              : null,
        };
      }
      case "QUEUED":
      case "PENDING_APPROVAL":
      case "PENDING_DEPOSIT":
      case "PENDING_SIGNATURE":
        return { status: "queued" as const };
      case "PROCESSING":
        return { status: "processing" as const };
      case "REFUNDED":
        return { status: "failed" as const, reason: "The route refunded the payment to the agent" };
      case "FAILED": {
        const code = status.failure_code ?? "";
        const provenUnsent = /never_(executed|submitted)/.test(
          `${code} ${JSON.stringify(details)}`,
        );
        return {
          status: "failed" as const,
          provenUnsent,
          reason: code || textOf(details, "failure_reason") || "The payment failed",
        };
      }
      case "UNCERTAIN":
        return {
          status: "uncertain" as const,
          reason: "The Agent API can't tell yet whether it was paid",
        };
      case "NEEDS_REVIEW":
        return {
          status: "needs_review" as const,
          reason:
            textOf(details, "reason") ?? status.failure_code ?? "A person must review this payout",
        };
    }
  }

  async function updatePayout(id: string, patch: Partial<AgentPayoutRow>) {
    const [row] = await db
      .update(agentPayouts)
      .set({ ...patch, updatedAt: now() })
      .where(eq(agentPayouts.id, id))
      .returning();
    return row!;
  }

  return {
    available,

    view,

    saveSettings: async (
      organizationId: string,
      actorId: string,
      input: { ownerAccountId: string; monthlyBudgetUsd: string; maxPayoutNear: string },
    ) => {
      const ownerAccountId = input.ownerAccountId.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,64}$/.test(ownerAccountId)) {
        throw badRequest("INVALID_ACCOUNT", "Enter the NEAR account that owns the payout agent");
      }
      if (!DECIMAL.test(input.monthlyBudgetUsd) || Number(input.monthlyBudgetUsd) <= 0) {
        throw badRequest("INVALID_BUDGET", "The monthly budget must be a positive USD amount");
      }
      try {
        if (BigInt(nearToAtomic(input.maxPayoutNear)) <= 0n) throw new Error("zero");
      } catch {
        throw badRequest("INVALID_CAP", "The maximum per payout must be a positive NEAR amount");
      }
      const existing = await settings(organizationId);
      if (existing?.agentId && existing.ownerAccountId !== ownerAccountId) {
        throw badRequest("OWNER_FIXED", "The payout agent's owner can't change once it's created");
      }
      const values = {
        organizationId,
        ownerAccountId,
        monthlyBudgetUsd: input.monthlyBudgetUsd,
        maxPayoutNear: input.maxPayoutNear,
        updatedBy: actorId,
        updatedAt: now(),
      };
      await db
        .insert(payoutAgents)
        .values(values)
        .onConflictDoUpdate({ target: payoutAgents.organizationId, set: values });
      return view(organizationId);
    },

    prepare: async (
      organizationId: string,
      input: { action: PayoutAction; publicKey?: string | null },
    ) => {
      const row = await settings(organizationId);
      if (!row) throw badRequest("NO_SETTINGS", "Save the payout settings first");
      const built = await prepareRequest(row, input.action, input.publicKey);
      let generated: GenerateIntentResponse;
      try {
        generated = await api().generateIntent(built.request);
      } catch (error) {
        throw badRequest("AGENT_API", `The Agent API refused it: ${errorText(error)}`);
      }
      if (generated.signer.type !== "near" || generated.signer.account_id !== row.ownerAccountId) {
        throw badRequest(
          "OWNER_MISMATCH",
          `This would be signed by ${"account_id" in generated.signer ? generated.signer.account_id : "another wallet"}, not ${row.ownerAccountId}`,
        );
      }
      await db.insert(payoutIntents).values({
        correlationId: generated.correlation_id,
        organizationId,
        action: input.action,
        intentType: generated.type,
        intent: JSON.stringify(generated.intent),
        agentId: generated.agent_id ?? row.agentId,
        grantTokenEnc: built.grant ? seal(built.grant.token, deps.secretKey!) : null,
        grantExpiresAt: built.grant?.expiresAt ?? null,
        status: generated.status,
        createdAt: now(),
        updatedAt: now(),
      });
      return {
        correlationId: generated.correlation_id,
        action: input.action,
        intent: generated.intent as unknown as Record<string, unknown>,
        signerAccountId: row.ownerAccountId,
        summary: generated.preview?.summary ?? null,
        expiresAt: generated.expires_at,
      };
    },

    submit: async (
      organizationId: string,
      input: { correlationId: string; signedData: unknown },
    ) => {
      const [intent] = await db
        .select()
        .from(payoutIntents)
        .where(
          and(
            eq(payoutIntents.correlationId, input.correlationId),
            eq(payoutIntents.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!intent)
        throw badRequest("UNKNOWN_INTENT", "MultiAgency didn't prepare that. Start again.");
      const issued = JSON.parse(intent.intent) as { standard: string; payload: unknown };
      const signed = input.signedData as { standard?: unknown; payload?: unknown } | null;
      if (
        !signed ||
        signed.standard !== issued.standard ||
        JSON.stringify(signed.payload) !== JSON.stringify(issued.payload)
      ) {
        throw badRequest(
          "SIGNED_PAYLOAD_MISMATCH",
          "The signature isn't over what MultiAgency prepared",
        );
      }
      let status: StatusResponse;
      try {
        status = await api().submitIntent({
          type: intent.intentType,
          correlation_id: intent.correlationId,
          signed_data: input.signedData,
        });
        if (PENDING_INTENT.has(status.status)) {
          status = await api()
            .getStatus(intent.correlationId, { waitMs: 25_000 })
            .catch(() => status);
        }
      } catch (error) {
        throw badRequest("AGENT_API", `The Agent API refused it: ${errorText(error)}`);
      }
      await settleIntent(organizationId, intent.correlationId, status);
      return {
        status: status.status,
        failureCode: status.failure_code,
        view: await view(organizationId),
      };
    },

    depositAddress: async (organizationId: string) => {
      const row = await settings(organizationId);
      if (!row?.agentId) throw badRequest("AGENT_MISSING", "Create the payout agent first");
      let result: StatusResponse;
      try {
        result = await api().deposit(row.agentId, {
          origin_asset: NEAR_ASSET,
          destination_asset: NEAR_ASSET,
        });
      } catch (error) {
        throw badRequest("AGENT_API", `The Agent API refused it: ${errorText(error)}`);
      }
      const address = textOf(result.details, "deposit_address");
      if (!address)
        throw badRequest("NO_DEPOSIT_ADDRESS", "The Agent API returned no deposit address");
      return {
        address,
        memo: textOf(result.details, "memo"),
        minAmount: textOf(result.details, "min_amount"),
        expiresAt: textOf(result.details, "expires_at"),
      };
    },

    readiness: async (organizationId: string, payee: string) => {
      if (!available) return { ready: false, reason: unavailableReason };
      const row = await settings(organizationId);
      if (!row?.agentId) return { ready: false, reason: "No payout agent" };
      if (!grantOf(row))
        return { ready: false, reason: "MultiAgency's payout permission is missing or expired" };
      try {
        const current = await api().getPolicy(row.agentId);
        const policy = current.policy;
        if (!policy || current.status !== "APPLIED")
          return { ready: false, reason: "The agent's rules aren't applied" };
        if (policy.frozen) return { ready: false, reason: "Payouts are frozen" };
        if (policy.owner_approval)
          return { ready: false, reason: "The rules require a vote per payout" };
        if (!allowsPayee(policy, payee)) {
          return {
            ready: false,
            reason: `The signed rules don't allow paying ${payee} yet: sign the updated rules`,
          };
        }
        if (!policy.assets.includes(NEAR_ASSET) && policy.assets !== "any") {
          return { ready: false, reason: "The rules don't allow paying in NEAR" };
        }
        return { ready: true, reason: null };
      } catch (error) {
        return { ready: false, reason: `The Agent API couldn't be reached: ${errorText(error)}` };
      }
    },

    send: async (
      organizationId: string,
      input: { requestId: string; recipient: string; amount: string },
    ): Promise<AgentPayoutRow> => {
      const row = await settings(organizationId);
      const token = grantOf(row);
      if (!row?.agentId || !token)
        throw badRequest("PAYOUTS_NOT_READY", "The payout agent isn't ready");
      const previous = await db
        .select()
        .from(agentPayouts)
        .where(eq(agentPayouts.requestId, input.requestId))
        .orderBy(desc(agentPayouts.attempt));
      const last = previous[0];
      if (last && !(last.status === "refused" || (last.status === "failed" && last.provenUnsent))) {
        throw badRequest("PAYOUT_EXISTS", `A payout for this request is already ${last.status}`);
      }
      const attempt = (last?.attempt ?? 0) + 1;
      const body = {
        asset: NEAR_ASSET,
        amount: input.amount,
        chain: "near",
        recipient: input.recipient,
      };
      const [created] = await db
        .insert(agentPayouts)
        .values({
          id: `${input.requestId}:a${attempt}`,
          organizationId,
          requestId: input.requestId,
          attempt,
          status: "sending",
          idempotencyKey: `multiagency:${input.requestId}:a${attempt}`,
          requestBody: JSON.stringify(body),
          recipient: input.recipient,
          amount: input.amount,
          assetId: NEAR_ASSET,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      return transmit(created!, row.agentId, token);
    },

    refresh: async (payout: AgentPayoutRow): Promise<AgentPayoutRow> => {
      if (!OPEN_PAYOUT.includes(payout.status)) return payout;
      const row = await settings(payout.organizationId);
      if (payout.status === "sending") {
        const token = grantOf(row);
        if (!row?.agentId || !token) return payout;
        return transmit(payout, row.agentId, token);
      }
      if (!payout.correlationId) return payout;
      try {
        const status = await api().getStatus(payout.correlationId);
        const next = applyStatus(status);
        return next ? updatePayout(payout.id, next) : payout;
      } catch {
        return payout;
      }
    },

    latest: async (requestId: string) => {
      const [row] = await db
        .select()
        .from(agentPayouts)
        .where(eq(agentPayouts.requestId, requestId))
        .orderBy(desc(agentPayouts.attempt))
        .limit(1);
      return row ?? null;
    },

    openPayouts: async () =>
      db
        .select()
        .from(agentPayouts)
        .where(inArray(agentPayouts.status, [...OPEN_PAYOUT])),
  };

  async function transmit(
    payout: AgentPayoutRow,
    agentId: string,
    token: string,
  ): Promise<AgentPayoutRow> {
    try {
      const result = await api().forGrant(token).withdraw(agentId, JSON.parse(payout.requestBody), {
        idempotencyKey: payout.idempotencyKey,
      });
      const next = applyStatus(result);
      return updatePayout(payout.id, { correlationId: result.correlation_id, ...(next ?? {}) });
    } catch (error) {
      if (error instanceof AgentApiError && PROVEN_REFUSALS.has(error.code)) {
        return updatePayout(payout.id, {
          status: "refused",
          provenUnsent: true,
          reason: errorText(error),
        });
      }
      if (isRetryable(error)) return payout;
      if (error instanceof AgentApiError) {
        return updatePayout(payout.id, {
          status: "needs_review",
          reason: `${errorText(error)} (not retried automatically: check the agent's history before paying again)`,
        });
      }
      return payout;
    }
  }
}

export type PayoutAgents = ReturnType<typeof createPayoutAgents>;

export function workOrderPayees(db: Database) {
  return async (organizationId: string) =>
    (
      await db
        .selectDistinct({ payee: workOrders.builderNearAccount })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.organizationId, organizationId),
            inArray(workOrders.status, ["accepted", "active", "ended", "exhausted"]),
            inArray(workOrders.tokenId, ["usd", "near"]),
          ),
        )
    ).map((r) => r.payee);
}
