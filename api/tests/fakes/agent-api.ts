import {
  AgentApiError,
  type GenerateIntentResponse,
  type Policy,
  type StatusResponse,
} from "@near-intents-agent-api/sdk";
import { generateKey, generateNonce, Near } from "near-kit";
import type { AgentApiPort } from "../../src/services/payouts/service";

type Status = StatusResponse["status"];

export class FakeAgentApi implements AgentApiPort {
  owner = "rita.near";
  ownerKeyPair = generateKey();
  ownerKey = this.ownerKeyPair.publicKey.toString();
  monthlySpentUsd = "0";
  monthlyResetsAt: string | null = null;
  policyChangeAvailableAt: string | null = null;
  price = 2;
  agentId = "agent-1";
  policy: Policy | null = null;
  revision: number | null = null;
  generated: Record<string, unknown>[] = [];
  submitted: { type: string; correlation_id: string; signed_data: unknown }[] = [];
  withdrawals: { grant: string | null; body: unknown; key: string }[] = [];
  statuses = new Map<string, { status: Status; details: Record<string, unknown> }>();
  nextWithdraw: { status: Status; details?: Record<string, unknown> } | { refuse: string } = {
    status: "SUCCESS",
    details: { tx_hash: "TXHASH1" },
  };
  nextSubmit: Status | null = null;
  onWithdraw: (() => Promise<void>) | null = null;
  private counter = 0;
  private pending = new Map<string, Record<string, unknown>>();

  constructor(private readonly grant: string | null = null) {}

  forGrant(grantToken: string): AgentApiPort {
    const scoped = Object.create(this) as FakeAgentApi;
    Object.defineProperty(scoped, "grant", { value: grantToken });
    return scoped;
  }

  async generateIntent(request: unknown): Promise<GenerateIntentResponse> {
    const body = request as Record<string, unknown>;
    this.generated.push(body);
    this.counter += 1;
    const correlationId = `corr-${this.counter}`;
    this.pending.set(correlationId, body);
    const nep366 = ["agent_create", "agent_freeze", "agent_unfreeze"].includes(String(body.type));
    return {
      correlation_id: correlationId,
      type: body.type as GenerateIntentResponse["type"],
      agent_id: (body.agent_id as string) ?? this.agentId,
      status: "PENDING_SIGNATURE",
      expires_at: "2026-09-21T00:00:00.000Z",
      signer: { type: "near", account_id: this.owner, public_key: this.ownerKey },
      intent: nep366
        ? {
            standard: "nep366",
            payload: {
              receiverId: "intents.near",
              actions: [
                {
                  type: "FunctionCall",
                  params: {
                    methodName: "add_public_key",
                    args: { agent: this.agentId },
                    gas: "30000000000000",
                    deposit: "1",
                  },
                },
              ],
            },
          }
        : {
            standard: "nep413",
            payload: {
              message: `sign ${correlationId}`,
              recipient: "intents.near",
              nonce: Buffer.from(generateNonce()).toString("base64"),
            },
          },
      preview: { summary: `Do ${String(body.type)}` },
    } as unknown as GenerateIntentResponse;
  }

  async sign(intent: Record<string, unknown>, keyPair = this.ownerKeyPair) {
    const payload = intent.payload as Record<string, unknown>;
    if (intent.standard === "nep413") {
      const signed = keyPair.signNep413Message?.(this.owner, {
        message: String(payload.message),
        recipient: String(payload.recipient),
        nonce: new Uint8Array(Buffer.from(String(payload.nonce), "base64")),
      });
      return { ...intent, public_key: signed?.publicKey, signature: signed?.signature };
    }
    const near = new Near({
      network: "mainnet",
      privateKey: keyPair.secretKey,
      defaultSignerId: this.owner,
    } as ConstructorParameters<typeof Near>[0]);
    const actions = payload.actions as {
      params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
    }[];
    const builder = actions.reduce(
      (tx, { params }) =>
        tx.functionCall(String(payload.receiverId), params.methodName, params.args, {
          gas: params.gas as `${number}`,
          attachedDeposit: BigInt(params.deposit),
        }),
      near.transaction(this.owner),
    );
    const { payload: signedDelegate } = await builder.delegate({ maxBlockHeight: 100n, nonce: 1n });
    return { ...intent, signed_delegate: signedDelegate };
  }

  async submitIntent(request: { type: string; correlation_id: string; signed_data: unknown }) {
    this.submitted.push(request);
    const body = this.pending.get(request.correlation_id) ?? {};
    if (this.nextSubmit) {
      const status = this.nextSubmit;
      this.nextSubmit = null;
      this.statuses.set(request.correlation_id, { status, details: {} });
      return this.status(request.correlation_id, status, {});
    }
    if (body.type === "agent_create" || body.type === "policy_update") {
      this.policy = body.policy as Policy;
      this.revision = (this.revision ?? 0) + 1;
    }
    if (body.type === "agent_freeze" && this.policy) this.policy = { ...this.policy, frozen: true };
    if (body.type === "agent_unfreeze" && this.policy)
      this.policy = { ...this.policy, frozen: false };
    return this.status(request.correlation_id, "SUCCESS", {
      agent_id: this.agentId,
      revision: this.revision,
    });
  }

  async getStatus(correlationId: string) {
    const known = this.statuses.get(correlationId);
    return this.status(correlationId, known?.status ?? "SUCCESS", known?.details ?? {});
  }

  async getPolicy() {
    return {
      wallet_id: this.agentId,
      revision: this.revision,
      policy_hash: null,
      status: this.policy ? "APPLIED" : "NONE",
      applied_at: null,
      transaction_hash: null,
      provider_policy_synced: true,
      cooldowns: {
        policy_change_available_at: this.policyChangeAvailableAt,
        unfreeze_available_at: null,
      },
      policy: this.policy,
      usage: {
        budget: {
          daily: { limit_usd: null, spent_usd: "0", remaining_usd: null, resets_at: null },
          weekly: { limit_usd: null, spent_usd: "0", remaining_usd: null, resets_at: null },
          monthly: {
            limit_usd: this.policy?.budget.monthly_usd ?? null,
            spent_usd: this.monthlySpentUsd,
            remaining_usd:
              this.policy?.budget.monthly_usd != null
                ? (Number(this.policy.budget.monthly_usd) - Number(this.monthlySpentUsd)).toFixed(2)
                : null,
            resets_at: this.monthlyResetsAt,
          },
        },
        timelock: { delay_ms: 0 },
      },
    } as never;
  }

  balanceRaw = "0";

  async getBalances() {
    return {
      near_account_id: "agent.near",
      source: "public",
      balances: [
        {
          asset_id: "nep141:wrap.near",
          symbol: "wNEAR",
          decimals: 24,
          blockchain: "near",
          price: this.price,
          price_updated_at: null,
          price_expires_at: null,
          balance_raw: this.balanceRaw,
          balance: null,
        },
      ],
    } as never;
  }

  async deposit() {
    return this.status("dep-1", "PENDING_DEPOSIT", { deposit_address: "deposit.near", memo: null });
  }

  async withdraw(_agentId: string, request: unknown, options: { idempotencyKey: string }) {
    this.withdrawals.push({ grant: this.grant, body: request, key: options.idempotencyKey });
    await this.onWithdraw?.();
    const next = this.nextWithdraw;
    if ("refuse" in next) {
      throw new AgentApiError(422, {
        errors: [{ code: next.refuse, title: next.refuse }],
      } as never);
    }
    const correlationId = `pay-${this.withdrawals.length}`;
    this.statuses.set(correlationId, { status: next.status, details: next.details ?? {} });
    return this.status(correlationId, next.status, next.details ?? {});
  }

  private status(correlationId: string, status: Status, details: Record<string, unknown>) {
    return {
      correlation_id: correlationId,
      agent_id: this.agentId,
      status,
      failure_code: null,
      created_at: "2026-09-20T12:00:00.000Z",
      updated_at: "2026-09-20T12:00:00.000Z",
      dispatch_committed_at: null,
      grant: null,
      type: "withdraw",
      details,
    } as unknown as StatusResponse;
  }
}
