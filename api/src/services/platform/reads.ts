import { badRequest, type PlatformAgents, platformError } from "./agents";
import type { OwnerResult, PlatformApp } from "./client";

const LIST_LIMIT = 50;

type AgentCalls = ReturnType<PlatformApp["agent"]>;

const text = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : null;

const newestFirst = <T extends { at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIST_LIMIT);

export function createPlatformReads(deps: { app: PlatformApp | null; agents: PlatformAgents }) {
  async function read<T>(
    organizationId: string,
    call: (calls: AgentCalls) => Promise<OwnerResult<T>>,
  ): Promise<T> {
    const connection = await deps.agents.connection(organizationId);
    if (!deps.app || !connection) {
      throw badRequest("This Organization has no connected platform agent with read access");
    }
    const result = await call(deps.app.agent(organizationId, connection.agent));
    if (result.ok) return result.value;
    await deps.agents.accessFailed(organizationId, connection.consentId, result);
    throw platformError(result);
  }

  return {
    overview: async (organizationId: string) => {
      const o = await read(organizationId, (c) => c.call("overview"));
      const policy = o.policy.policy;
      const monthly = o.policy.usage?.budget.monthly ?? null;
      return {
        agentId: o.agentId,
        revision: o.policy.revision,
        status: o.policy.status,
        synced: o.policy.provider_policy_synced,
        notInForce: o.notInForce,
        frozen: policy?.frozen ?? null,
        ownerApproval: policy?.owner_approval ?? null,
        assets: policy ? (policy.assets === "any" ? ["any"] : policy.assets) : [],
        perTransaction: policy?.limits.per_transaction ?? {},
        budget: {
          dailyUsd: policy?.budget.daily_usd ?? null,
          weeklyUsd: policy?.budget.weekly_usd ?? null,
          monthlyUsd: policy?.budget.monthly_usd ?? null,
        },
        monthly: monthly
          ? {
              limitUsd: monthly.limit_usd,
              spentUsd: monthly.spent_usd,
              remainingUsd: monthly.remaining_usd,
              resetsAt: monthly.resets_at,
            }
          : null,
        destinationsMode: policy?.destinations.mode ?? null,
        destinations: (policy?.destinations.list ?? []).map((d) => ({
          action: d.action,
          address: d.address,
          chain: d.action === "withdraw" ? d.chain : null,
        })),
        agreed: o.agreed,
        policyChangeAvailableAt: o.policy.cooldowns.policy_change_available_at,
        book: o.book.map((h) => ({
          asset: h.asset,
          symbol: h.symbol,
          decimals: h.decimals,
          public: h.public.toString(),
          confidential: h.confidential.toString(),
          usd: h.usd,
        })),
        grants: o.grants.map((g) => ({
          grantId: g.grant_id,
          label: g.label,
          issuedAt: g.issued_at,
          expiresAt: g.expires_at,
          revokedAt: g.revoked_at,
        })),
      };
    },

    unresolved: async (organizationId: string) =>
      (await read(organizationId, (c) => c.call("unresolved"))).map((u) => ({
        key: u.key,
        at: u.at,
        kind: u.kind,
        status: u.status,
        sent: u.sent,
      })),

    held: async (organizationId: string) =>
      (await read(organizationId, (c) => c.call("held"))).map((h) => ({
        at: h.at,
        kind: h.kind,
        correlationId: h.correlationId,
        approvalId: h.approvalId,
        recipient: text(h.request.recipient),
        amount: text(h.request.amount),
        asset: text(h.request.asset),
        chain: text(h.request.chain),
      })),

    activity: async (organizationId: string) =>
      newestFirst(await read(organizationId, (c) => c.call("activity"))).map((a) => ({
        at: a.at,
        kind: a.kind,
        correlationId: a.correlationId ?? null,
        status: a.status ?? null,
        refused: a.refused ?? null,
      })),

    ledger: async (organizationId: string) =>
      newestFirst(await read(organizationId, (c) => c.call("ledger"))).map((l) => ({
        at: l.at,
        settledAt: l.settledAt,
        type: l.type,
        status: l.status,
        failureCode: l.failureCode,
        asset: l.assetOut ?? l.assetIn,
        amount: l.amountOut ?? l.amountIn,
        recipient: l.recipient,
        correlationId: l.correlationId,
      })),

    policyHistory: async (organizationId: string) =>
      (await read(organizationId, (c) => c.call("policyHistory"))).map((p) => ({
        revision: p.revision,
        status: p.status,
        appliedAt: p.appliedAt,
        transactionHash: p.transactionHash,
      })),

    ownerActions: async (organizationId: string) =>
      (await read(organizationId, (c) => c.call("owner/actions"))).map((a) => ({
        correlationId: a.correlationId,
        type: a.type,
        expiresAt: a.expiresAt,
        stage: a.stage,
        status: a.status,
        failureCode: a.failureCode,
      })),
  };
}

export type PlatformReads = ReturnType<typeof createPlatformReads>;
