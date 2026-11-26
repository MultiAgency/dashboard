import { createHash, randomBytes } from "node:crypto";
import { parseConsentMessage, parseSetupMessage } from "@multiagency/sdk";
import type { PlatformApp } from "../../src/services/platform/client";

type Failure = { ok: false; kind: string; status?: number; code?: string; error?: string };
type Consent = {
  id: string;
  deployment: string;
  host: string;
  organization: string;
  owner: string;
  agent: string;
  agentId: string;
  scopes: string[];
  expiresAt: number;
  createdAt: number;
  publicKey: string;
  revoked: boolean;
  revokedAt: number | null;
  signer: "wallet";
};
type Reservation = {
  agent: string;
  organization: string;
  owner: string;
  area: string;
  agentId: string | null;
  setupKey: string | null;
};

const ok = <T>(value: T) => ({ ok: true as const, value });

export class FakePlatformApp {
  readonly host: string;
  readonly deployment: string;
  calls: Array<{ route: string; body?: unknown }> = [];
  createMode: "confirm" | "nep413" = "confirm";
  reservations = new Map<string, Reservation>();
  consents = new Map<string, Consent>();
  opened = new Map<
    string,
    {
      agent: string;
      type: string;
      submitted: boolean;
      intent: Record<string, unknown>;
      apply: () => void;
    }
  >();
  held: Array<{
    at: string;
    kind: string;
    request: Record<string, unknown>;
    correlationId: string;
    approvalId: string;
  }> = [
    {
      at: "2026-11-25T10:00:00Z",
      kind: "remote",
      request: {
        asset: "nep141:usdc",
        amount: "5000000",
        recipient: "carol.near",
        confidential: true,
      },
      correlationId: "held-1",
      approvalId: "appr-1",
    },
  ];
  votes: Array<{ approvalId: string; verdict: string }> = [];
  deposits = new Map<string, { asset: string; address: string }>();
  private failures = new Map<string, Failure[]>();
  private lost = new Set<string>();
  private now: () => number;

  constructor(options: { host: string; deployment: string; now?: () => number }) {
    this.host = options.host;
    this.deployment = options.deployment;
    this.now = options.now ?? Date.now;
  }

  failNext(route: string, failure: Failure, times = 1) {
    this.failures.set(route, [...(this.failures.get(route) ?? []), ...Array(times).fill(failure)]);
  }

  loseNextAnswer(route: string) {
    this.lost.add(route);
  }

  count(route: string) {
    return this.calls.filter((c) => c.route === route).length;
  }

  reserve(reservation: Omit<Reservation, "setupKey"> & { setupKey?: string | null }) {
    this.reservations.set(reservation.agent, { setupKey: null, ...reservation });
  }

  confirm(correlationId: string) {
    const open = this.opened.get(correlationId);
    if (!open || open.submitted) throw new Error(`nothing open for ${correlationId}`);
    open.submitted = true;
    open.apply();
  }

  private applyPolicy(changes: Record<string, unknown>) {
    const policy = this.overview.policy.policy as Record<string, unknown> & {
      actions: string[];
      destinations: { mode: string; list: Array<Record<string, unknown>> };
    };
    const { withdrawals, destinations, ...fields } = changes as {
      withdrawals?: Array<{ address: string }>;
      destinations?: Array<{ address: string; confidential: boolean }>;
    };
    Object.assign(policy, fields);
    const list = policy.destinations.list;
    const transfers = destinations
      ? destinations.map((d) => ({ action: "transfer", ...d }))
      : list.filter((d) => d.action === "transfer");
    const toNear = withdrawals
      ? withdrawals.map(({ address }) => ({
          action: "withdraw",
          chain: "near",
          address,
          memo: null,
        }))
      : list.filter((d) => d.action === "withdraw");
    policy.destinations = { mode: "only", list: [...transfers, ...toNear] };
    policy.actions = [
      ...(transfers.length ? ["transfer"] : []),
      ...(toNear.length ? ["withdraw"] : []),
    ];
    this.overview.policy.revision += 1;
    this.overview.digest = `d${this.overview.policy.revision}`;
  }

  private readable(changes: Record<string, unknown>) {
    const withdrawing = (this.overview.policy.policy as { actions: string[] }).actions.includes(
      "withdraw",
    );
    return Object.keys(changes).every(
      (key) => key === "destinations" || key === "budget" || (key === "withdrawals" && withdrawing),
    );
  }

  confirmCreate(agent: string) {
    const reservation = this.reservations.get(agent);
    if (!reservation) throw new Error(`no reservation ${agent}`);
    reservation.agentId = `agent-id-${agent}`;
  }

  private take(route: string, body?: unknown): Failure | null {
    this.calls.push({ route, body });
    const queue = this.failures.get(route);
    return queue?.shift() ?? null;
  }

  private agentName(organization: string, owner: string, area: string) {
    const hash = createHash("sha256")
      .update(`app:${this.deployment}:${organization}:${owner}:${area}`)
      .digest("hex");
    return `own-${hash.slice(0, 24)}`;
  }

  private store(
    submission: { signature: string; publicKey: string },
    fields: Omit<
      Consent,
      "id" | "createdAt" | "revoked" | "revokedAt" | "signer" | "publicKey" | "deployment" | "host"
    >,
  ): Consent {
    const id = createHash("sha256").update(submission.signature).digest("hex").slice(0, 32);
    const existing = this.consents.get(id);
    if (existing) return existing;
    const consent: Consent = {
      id,
      deployment: this.deployment,
      host: this.host,
      createdAt: this.now(),
      revoked: false,
      revokedAt: null,
      signer: "wallet",
      publicKey: submission.publicKey,
      ...fields,
    };
    this.consents.set(id, consent);
    return consent;
  }

  private liveConsent(organization: string, agent: string, scope: string) {
    const reservation = this.reservations.get(agent);
    return [...this.consents.values()].find(
      (c) =>
        c.organization === organization &&
        c.agent === agent &&
        !c.revoked &&
        c.expiresAt > this.now() &&
        c.scopes.includes(scope) &&
        (c.agentId === "unborn" ? scope === "owner" : c.agentId === reservation?.agentId),
    );
  }

  overview = {
    agentId: "",
    area: "payables",
    book: [
      {
        asset: "nep141:usdc",
        symbol: "USDC",
        decimals: 6,
        public: 0n,
        confidential: 12_500_000n,
        price: 1,
        priceUpdatedAt: null,
        priceExpiresAt: null,
        usd: 12.5,
      },
    ],
    policy: {
      wallet_id: "w",
      revision: 3,
      status: "APPLIED",
      provider_policy_synced: true,
      cooldowns: { policy_change_available_at: null, unfreeze_available_at: null },
      policy: {
        frozen: false,
        actions: ["transfer"],
        confidential: true,
        owner_approval: true,
        assets: ["nep141:usdc"],
        limits: { per_transaction: { "nep141:usdc": "100000000" } },
        max_actions_per_hour: null,
        destinations: {
          mode: "only",
          list: [{ action: "transfer", address: "carol.near", confidential: true }],
        },
        budget: { daily_usd: null, weekly_usd: null, monthly_usd: "500" },
        timelock_ms: 0,
      },
      usage: {
        budget: {
          daily: { limit_usd: null, spent_usd: "0", remaining_usd: null, resets_at: null },
          weekly: { limit_usd: null, spent_usd: "0", remaining_usd: null, resets_at: null },
          monthly: {
            limit_usd: "500",
            spent_usd: "20",
            remaining_usd: "480",
            resets_at: "2026-12-01T00:00:00Z",
          },
        },
        timelock: { delay_ms: 0, scheduled_count: 0 },
      },
    },
    digest: "d",
    notInForce: null,
    agreed: ["carol.near"],
    grants: [],
  };

  client(): PlatformApp {
    const app = {
      identity: async (agent: string) => {
        const failure = this.take("identity", agent);
        if (failure) return failure;
        const reservation = this.reservations.get(agent);
        if (!reservation)
          return { ok: false, kind: "refused", status: 404, code: "not_found", error: "no agent" };
        return ok({
          agent,
          owner: reservation.owner,
          agentId: reservation.agentId,
          created: reservation.agentId !== null,
          host: this.host,
          deployment: this.deployment,
          signer: "wallet",
        });
      },
      reservations: async (query: { organization: string; owner?: string; area?: string }) => {
        const failure = this.take("reservations", query);
        if (failure) return failure;
        return ok({
          agents: [...this.reservations.values()]
            .filter(
              (r) =>
                r.organization === query.organization &&
                (!query.owner || r.owner === query.owner) &&
                (!query.area || r.area === query.area),
            )
            .map(({ agent, organization, owner, area }) => ({ agent, organization, owner, area })),
        });
      },
      setup: async (submission: {
        message: string;
        nonce: string;
        publicKey: string;
        signature: string;
      }) => {
        const failure = this.take("setup", submission);
        if (failure) return failure;
        const setup = parseSetupMessage(submission.message);
        if (!setup || setup.host !== this.host || setup.deployment !== this.deployment) {
          return {
            ok: false,
            kind: "refused",
            status: 400,
            code: "invalid_request",
            error: "bad text",
          };
        }
        if (Date.parse(setup.expiresAt) <= this.now()) {
          return {
            ok: false,
            kind: "refused",
            status: 400,
            code: "signed_expired",
            error: "expired",
          };
        }
        const agent = this.agentName(setup.organization, setup.owner, setup.area);
        const existing = this.reservations.get(agent);
        if (existing?.agentId) {
          return {
            ok: false,
            kind: "refused",
            status: 409,
            code: "already_created",
            error: "created",
          };
        }
        this.reservations.set(agent, {
          agent,
          organization: setup.organization,
          owner: setup.owner,
          area: setup.area,
          agentId: null,
          setupKey: submission.publicKey,
        });
        const consent = this.store(submission, {
          organization: setup.organization,
          owner: setup.owner,
          agent,
          agentId: "unborn",
          scopes: ["owner"],
          expiresAt: Date.parse(setup.expiresAt),
        });
        return ok({ agent, consent });
      },
      consents: {
        nonce: async () => {
          const failure = this.take("consents.nonce");
          if (failure) return failure;
          return ok({ nonce: randomBytes(32).toString("base64"), issuedAt: this.now() });
        },
        submit: async (submission: {
          message: string;
          nonce: string;
          publicKey: string;
          signature: string;
        }) => {
          const failure = this.take("consents.submit", submission);
          if (failure) return failure;
          const consent = parseConsentMessage(submission.message);
          if (!consent || consent.host !== this.host || consent.deployment !== this.deployment) {
            return {
              ok: false,
              kind: "refused",
              status: 400,
              code: "invalid_request",
              error: "bad text",
            };
          }
          const reservation = this.reservations.get(consent.agent);
          if (!reservation?.agentId) {
            return {
              ok: false,
              kind: "refused",
              status: 409,
              code: "not_created",
              error: "not created",
            };
          }
          if (reservation.agentId !== consent.agentId) {
            return {
              ok: false,
              kind: "refused",
              status: 409,
              code: "agent_changed",
              error: "changed",
            };
          }
          const stored = this.store(submission, {
            organization: consent.organization,
            owner: consent.owner,
            agent: consent.agent,
            agentId: consent.agentId,
            scopes: [...consent.scopes],
            expiresAt: Date.parse(consent.expiresAt),
          });
          if (this.lost.delete("consents.submit")) return { ok: false, kind: "unavailable" };
          return ok({ consent: stored });
        },
        revoke: async (id: string) => {
          const failure = this.take("consents.revoke", id);
          if (failure) return failure;
          const consent = this.consents.get(id);
          if (!consent)
            return { ok: false, kind: "refused", status: 404, code: "not_found", error: "gone" };
          consent.revoked = true;
          consent.revokedAt = this.now();
          return ok({ revoked: true as const });
        },
        list: async (organization?: string) => {
          const failure = this.take("consents.list", organization);
          if (failure) return failure;
          return ok({
            consents: [...this.consents.values()].filter(
              (c) => !organization || c.organization === organization,
            ),
          });
        },
      },
      agent: (organization: string, agent: string) => ({
        call: async (path: string, input?: Record<string, unknown>) => {
          const answer = await agentCall(organization, agent, path, input);
          if (!this.lost.delete(`agent:${path}`)) return answer;
          return { ok: false, kind: "unknown", procedure: path, identity: {} };
        },
      }),
    };
    const agentCall = async (
      organization: string,
      agent: string,
      path: string,
      input?: Record<string, unknown>,
    ): Promise<unknown> => {
      const route = `agent:${path}`;
      const failure = this.take(route, { organization, agent, input });
      if (failure) return failure;
      const scope = path.startsWith("owner/") ? "owner" : path === "deposit" ? "payout" : "read";
      if (!this.liveConsent(organization, agent, scope)) {
        return {
          ok: false,
          kind: "forbidden",
          status: 403,
          code: "no_consent",
          error: "no consent",
        };
      }
      const reservation = this.reservations.get(agent);
      if (path === "owner/prepare") {
        const action = (input?.action ?? {}) as {
          type: string;
          owner?: { public_key: string };
          expectedPolicy?: { revision: number; digest: string };
          changes?: Record<string, unknown>;
          grantId?: string;
          expiresAt?: string;
          approvalId?: string;
          verdict?: string;
        };
        if (action.type === "agent_create" && action.owner?.public_key !== reservation?.setupKey) {
          return { ok: false, kind: "refused", code: "setup_key", error: "not the setup key" };
        }
        if (
          action.type === "policy_update" &&
          (action.expectedPolicy?.revision !== this.overview.policy.revision ||
            action.expectedPolicy?.digest !== this.overview.digest)
        ) {
          return { ok: false, kind: "refused", error: "The policy changed since review." };
        }
        const correlationId = `corr-${this.opened.size + 1}`;
        const intent = {
          standard: "nep413",
          payload: {
            message: `${action.type} ${agent}`,
            recipient: "outlayer.near",
            nonce: randomBytes(32).toString("base64"),
          },
        };
        const grants = this.overview.grants as Array<Record<string, unknown>>;
        const applies: Record<string, () => void> = {
          agent_create: () => this.confirmCreate(agent),
          policy_update: () => this.applyPolicy(action.changes ?? {}),
          grant_issue: () =>
            grants.push({
              grant_id: `grant-${grants.length + 1}`,
              agent_id: "a",
              wallet_id: "w",
              label: "payout",
              issued_at: new Date(this.now()).toISOString(),
              expires_at: action.expiresAt,
              revoked_at: null,
              owner_epoch: 1,
              owner_message: null,
            }),
          grant_revoke: () => {
            const grant = grants.find((g) => g.grant_id === action.grantId);
            if (grant) grant.revoked_at = new Date(this.now()).toISOString();
          },
          agent_freeze: () => {
            (this.overview.policy.policy as { frozen: boolean }).frozen = true;
          },
          agent_unfreeze: () => {
            (this.overview.policy.policy as { frozen: boolean }).frozen = false;
          },
          approval_vote: () => {
            this.held = this.held.filter((h) => h.approvalId !== action.approvalId);
            this.votes.push({
              approvalId: String(action.approvalId),
              verdict: String(action.verdict),
            });
          },
        };
        const apply = applies[action.type];
        if (!apply) throw new Error(`unexpected ${action.type}`);
        this.opened.set(correlationId, {
          agent,
          type: action.type,
          submitted: false,
          intent,
          apply,
        });
        const viaConfirm =
          action.type === "agent_create"
            ? this.createMode === "confirm"
            : action.type === "agent_freeze" ||
              action.type === "agent_unfreeze" ||
              (action.type === "policy_update" && !this.readable(action.changes ?? {}));
        const expiresAt = new Date(this.now() + 600_000).toISOString();
        const policyPreview =
          action.type === "policy_update"
            ? { policy: { current: this.overview.policy.policy, requested: { ...action.changes } } }
            : {};
        return ok({
          correlationId,
          preview: { summary: action.type },
          expiresAt,
          digest: null,
          ...policyPreview,
          ...(viaConfirm
            ? { confirm: { url: `https://${this.host}/confirm/${correlationId}`, expiresAt } }
            : { intent }),
        });
      }
      if (path === "owner/submit") {
        const open = this.opened.get(String(input?.correlationId));
        if (!open || open.submitted) {
          return { ok: false, kind: "refused", code: "not_open", error: "not open" };
        }
        open.submitted = true;
        open.apply();
        return ok({ status: "SUCCESS" });
      }
      if (path === "owner/status") {
        const open = this.opened.get(String(input?.correlationId));
        return ok(
          open?.submitted
            ? { stage: "submitted", status: "SUCCESS", phase: "settled" }
            : { stage: "unknown", phase: "open" },
        );
      }
      if (path === "owner/pending") return ok([]);
      if (path === "owner/actions") {
        return ok(
          [...this.opened.entries()]
            .filter(([, o]) => o.agent === agent)
            .map(([correlationId, open]) => ({
              correlationId,
              type: open.type,
              expiresAt: new Date(this.now() + 600_000).toISOString(),
              signer: "wallet",
              stage: open.submitted ? "submitted" : "prepared",
              phase: open.submitted ? "submitted" : "open",
              ownerSucceeded: open.submitted,
              status: open.submitted ? "SUCCESS" : null,
              failureCode: null,
              payment: null,
            })),
        );
      }
      if (path === "overview") return ok({ ...this.overview, agentId: reservation?.agentId ?? "" });
      if (path === "unresolved") return ok([]);
      if (path === "held") return ok(this.held);
      if (path === "deposit") {
        const requestId = String(input?.requestId ?? `anon-${this.deposits.size}`);
        const recorded = this.deposits.get(requestId) ?? {
          asset: String(input?.asset),
          address: `deposit-address-${this.deposits.size + 1}`,
        };
        this.deposits.set(requestId, recorded);
        return ok({
          correlationId: `deposit-${requestId}`,
          address: recorded.address,
          memo: null,
          minAmount: "1000",
          expiresAt: new Date(this.now() + 3_600_000).toISOString(),
        });
      }
      if (path === "depositStatus") {
        const requestId = String(input?.requestId);
        const recorded = this.deposits.get(requestId);
        if (!recorded) return ok({ requestId, state: "not_found" });
        return ok({
          requestId,
          state: "ready",
          asset: recorded.asset,
          requestedAt: new Date(this.now()).toISOString(),
          deposit: {
            correlationId: `deposit-${requestId}`,
            address: recorded.address,
            memo: null,
            minAmount: "1000",
            expiresAt: new Date(this.now() + 3_600_000).toISOString(),
          },
        });
      }
      if (path === "activity" || path === "ledger" || path === "policyHistory") {
        return ok([]);
      }
      throw new Error(`unmodelled ${path}`);
    };
    return app as unknown as PlatformApp;
  }
}
