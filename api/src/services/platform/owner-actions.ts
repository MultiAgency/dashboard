import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { type PlatformOwnerActionRow, platformAgents, platformOwnerActions } from "../../db/schema";
import { baseUnitsToDisplay } from "../tokens";
import { badRequest, type PlatformAgents, platformError } from "./agents";
import type { AppOwnerAction, OwnerOutput, OwnerResult, PlatformApp } from "./client";
import type { PayoutTerms } from "./payouts";
import { type PayoutRules, rulesChanges } from "./rules";
import {
  GRANT_DAYS,
  GRANT_RENEW_DAYS,
  nep413Intent,
  type OwnerActionKind,
  type OwnerActionPhase,
  type PayoutVerdict,
} from "./terms";

const DAY_MS = 86_400_000;
const SIGNABLE = new Set(["prepared", "adopted"]);
const SENDING = new Set(["submitting", "submitted"]);
const ENDED: Array<OwnerActionPhase | null> = ["settled", "expired"];
const FOLLOWED_PER_VIEW = 5;
const ACTION_TYPES: Record<OwnerActionKind, AppOwnerAction["type"]> = {
  rules: "policy_update",
  grant: "grant_issue",
  grant_revoke: "grant_revoke",
  freeze: "agent_freeze",
  unfreeze: "agent_unfreeze",
  payout_vote: "approval_vote",
};
const SUMMARIES: Record<Exclude<OwnerActionKind, "rules" | "payout_vote">, string> = {
  grant: `Let MultiAgency pay within these rules for ${GRANT_DAYS} days`,
  grant_revoke: "Stop MultiAgency paying under permission",
  freeze: "Freeze the agent: it pays nothing until unfrozen",
  unfreeze: "Unfreeze the agent",
};

type AgentCalls = ReturnType<PlatformApp["agent"]>;
type Connection = NonNullable<Awaited<ReturnType<PlatformAgents["connection"]>>>;
type Held = OwnerOutput<"held">[number];
type Built = {
  action: AppOwnerAction;
  summary: string;
};
export type PrepareInput = {
  kind: OwnerActionKind;
  grantId?: string;
  approvalId?: string;
  verdict?: PayoutVerdict;
};

const text = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : null;
const tokenOf = (asset: string) => asset.replace(/^nep141:/, "");

export function createPlatformOwnerActions(deps: {
  db: Database;
  app: PlatformApp | null;
  agents: PlatformAgents;
  payees: (organizationId: string) => Promise<string[]>;
  payoutTerms: (
    organizationId: string,
    correlationIds: string[],
  ) => Promise<Map<string, PayoutTerms>>;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function connected(organizationId: string, scope: "read" | "owner") {
    const connection = await deps.agents.connection(organizationId);
    if (!deps.app || !connection) {
      throw badRequest("This Organization has no connected platform agent");
    }
    if (!connection.scopes.includes(scope)) {
      throw badRequest(
        `This Organization's consent doesn't include ${scope}. Ask the owner to sign a new one.`,
      );
    }
    return { calls: deps.app.agent(organizationId, connection.agent), connection };
  }

  async function answer<T>(organizationId: string, connection: Connection, result: OwnerResult<T>) {
    if (result.ok) return result.value;
    await deps.agents.accessFailed(organizationId, connection.consentId, result);
    throw platformError(result);
  }

  async function settingsOf(organizationId: string): Promise<PayoutRules | null> {
    const [row] = await db
      .select({
        asset: platformAgents.payoutAsset,
        maxPerPayout: platformAgents.maxPerPayout,
        monthlyBudgetUsd: platformAgents.monthlyBudgetUsd,
        ownerApproval: platformAgents.ownerApproval,
      })
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    return row?.asset && row.maxPerPayout && row.monthlyBudgetUsd
      ? {
          asset: row.asset,
          maxPerPayout: row.maxPerPayout,
          monthlyBudgetUsd: row.monthlyBudgetUsd,
          ownerApproval: row.ownerApproval,
        }
      : null;
  }

  async function actionsOf(organizationId: string) {
    return db
      .select()
      .from(platformOwnerActions)
      .where(eq(platformOwnerActions.organizationId, organizationId))
      .orderBy(desc(platformOwnerActions.createdAt));
  }

  function signable(action: PlatformOwnerActionRow) {
    return (
      SIGNABLE.has(action.status) &&
      !ENDED.includes(action.phase) &&
      action.expiresAt.getTime() > now().getTime()
    );
  }

  function inFlight(action: PlatformOwnerActionRow) {
    return (
      !ENDED.includes(action.phase) && (action.phase === "submitted" || SENDING.has(action.status))
    );
  }

  function isOpen(action: PlatformOwnerActionRow) {
    return signable(action) || inFlight(action);
  }

  function actionView(action: PlatformOwnerActionRow) {
    const open = isOpen(action);
    return {
      correlationId: action.correlationId,
      kind: action.kind,
      summary: action.summary,
      status: action.status,
      open,
      confirmUrl: signable(action) ? action.confirmUrl : null,
      expiresAt: action.expiresAt.toISOString(),
      createdAt: action.createdAt.toISOString(),
    };
  }

  function payoutGrants(overview: {
    grants: Array<{
      grant_id: string;
      label: string;
      expires_at: string;
      revoked_at: string | null;
    }>;
  }) {
    return overview.grants.filter(
      (g) => g.label === "payout" && !g.revoked_at && Date.parse(g.expires_at) > now().getTime(),
    );
  }

  function heldView(entry: Held, terms: PayoutTerms | undefined) {
    return {
      approvalId: entry.approvalId,
      correlationId: entry.correlationId,
      at: entry.at,
      recipient: text(entry.request.recipient),
      amount: text(entry.request.amount),
      asset: text(entry.request.asset),
      chain: text(entry.request.chain),
      terms: terms ?? null,
    };
  }

  async function heldOf(organizationId: string, connection: Connection, calls: AgentCalls) {
    const held = await answer(organizationId, connection, await calls.call("held"));
    const terms = await deps.payoutTerms(
      organizationId,
      held.map((h) => h.correlationId),
    );
    return held.map((h) => heldView(h, terms.get(h.correlationId)));
  }

  async function view(organizationId: string) {
    const { calls, connection } = await connected(organizationId, "read");
    const overview = await answer(organizationId, connection, await calls.call("overview"));
    const rules = await settingsOf(organizationId);
    const signed = overview.policy.policy;
    const pending =
      rules && signed ? rulesChanges(rules, await deps.payees(organizationId), signed).summary : [];
    const grant = payoutGrants(overview).sort((a, b) =>
      b.expires_at.localeCompare(a.expires_at),
    )[0];
    const unsettled = (await actionsOf(organizationId)).filter(isOpen).slice(0, FOLLOWED_PER_VIEW);
    for (const action of unsettled) {
      const status = await calls.call("owner/status", { correlationId: action.correlationId });
      if (status.ok) await noteStatus(action.correlationId, status.value);
    }
    return {
      rules,
      pending,
      applied: overview.policy.status === "APPLIED" && overview.policy.revision !== null,
      frozen: signed?.frozen ?? null,
      grant: grant
        ? {
            grantId: grant.grant_id,
            expiresAt: grant.expires_at,
            expiringSoon:
              Date.parse(grant.expires_at) - now().getTime() < GRANT_RENEW_DAYS * DAY_MS,
          }
        : null,
      held: await heldOf(organizationId, connection, calls),
      actions: (await actionsOf(organizationId)).slice(0, 20).map(actionView),
    };
  }

  async function saveRules(organizationId: string, actorId: string, rules: PayoutRules) {
    await connected(organizationId, "read");
    await db
      .update(platformAgents)
      .set({
        payoutAsset: rules.asset,
        maxPerPayout: rules.maxPerPayout,
        monthlyBudgetUsd: rules.monthlyBudgetUsd,
        ownerApproval: rules.ownerApproval,
        updatedBy: actorId,
        updatedAt: now(),
      })
      .where(eq(platformAgents.organizationId, organizationId));
    return view(organizationId);
  }

  async function build(
    organizationId: string,
    connection: Connection,
    calls: AgentCalls,
    input: PrepareInput,
  ): Promise<Built> {
    if (input.kind === "payout_vote") return vote(organizationId, connection, calls, input);
    if (input.kind === "grant") {
      return {
        action: {
          type: "grant_issue",
          label: "payout",
          expiresAt: new Date(now().getTime() + GRANT_DAYS * DAY_MS).toISOString(),
        },
        summary: SUMMARIES.grant,
      };
    }
    if (input.kind === "freeze")
      return { action: { type: "agent_freeze" }, summary: SUMMARIES.freeze };
    if (input.kind === "unfreeze") {
      return { action: { type: "agent_unfreeze" }, summary: SUMMARIES.unfreeze };
    }
    const overview = await answer(organizationId, connection, await calls.call("overview"));
    if (input.kind === "grant_revoke") {
      const grant = payoutGrants(overview).find((g) => g.grant_id === input.grantId);
      if (!grant) throw badRequest("That payout permission isn't live on the agent");
      return {
        action: { type: "grant_revoke", grantId: grant.grant_id },
        summary: `${SUMMARIES.grant_revoke} ${grant.grant_id}`,
      };
    }
    const rules = await settingsOf(organizationId);
    if (!rules) throw badRequest("Save the payout rules first");
    const signed = overview.policy.policy;
    if (!signed || overview.policy.revision === null || !overview.digest) {
      throw badRequest("The agent's current rules aren't applied yet. Try again shortly.");
    }
    const { changes, summary } = rulesChanges(rules, await deps.payees(organizationId), signed);
    if (summary.length === 0) throw badRequest("The signed rules already match");
    return {
      action: {
        type: "policy_update",
        expectedPolicy: { revision: overview.policy.revision, digest: overview.digest },
        changes,
      },
      summary: summary.join("; "),
    };
  }

  async function vote(
    organizationId: string,
    connection: Connection,
    calls: AgentCalls,
    input: PrepareInput,
  ): Promise<Built> {
    if (!input.approvalId || !input.verdict) {
      throw badRequest("Say which held payout to vote on, and how");
    }
    const held = (await heldOf(organizationId, connection, calls)).find(
      (h) => h.approvalId === input.approvalId,
    );
    if (!held) throw badRequest("That payout isn't waiting for the owner's vote");
    const amount =
      held.amount && held.asset
        ? baseUnitsToDisplay(held.amount, tokenOf(held.asset))
        : (held.amount ?? "an unknown amount");
    const purpose = held.terms ? ` for "${held.terms.workOrderTitle}"` : "";
    return {
      action: {
        type: "approval_vote",
        approvalId: held.approvalId,
        verdict: input.verdict,
        correlationId: held.correlationId,
      },
      summary: `${input.verdict === "approve" ? "Approve" : "Reject"} paying ${amount} to ${held.recipient ?? "an unknown payee"}${purpose}`,
    };
  }

  async function record(
    organizationId: string,
    agent: string,
    kind: OwnerActionKind,
    fields: Omit<typeof platformOwnerActions.$inferInsert, "organizationId" | "agent" | "kind">,
  ) {
    await db
      .insert(platformOwnerActions)
      .values({ ...fields, organizationId, agent, kind, createdAt: now(), updatedAt: now() })
      .onConflictDoNothing();
  }

  async function adopt(
    organizationId: string,
    connection: Connection,
    calls: AgentCalls,
    kind: OwnerActionKind,
    built: Built,
    actorId: string,
  ) {
    const actions = await answer(organizationId, connection, await calls.call("owner/actions"));
    const known = new Set((await actionsOf(organizationId)).map((a) => a.correlationId));
    const open = actions
      .filter(
        (a) =>
          !known.has(a.correlationId) &&
          a.type === ACTION_TYPES[kind] &&
          a.signer === "wallet" &&
          (a.stage === "prepared" || a.stage === "submitted") &&
          Date.parse(a.expiresAt) > now().getTime(),
      )
      .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0];
    if (!open) return null;
    await record(organizationId, connection.agent, kind, {
      correlationId: open.correlationId,
      summary: `${built.summary} (its answer was lost; recovered from the platform)`,
      expiresAt: new Date(open.expiresAt),
      status: open.stage === "prepared" ? "adopted" : "submitted",
      requestedBy: actorId,
    });
    return open.correlationId;
  }

  async function prepare(organizationId: string, actorId: string, input: PrepareInput) {
    const { calls, connection } = await connected(organizationId, "owner");
    const built = await build(organizationId, connection, calls, input);
    const { action, summary } = built;
    const open = (await actionsOf(organizationId)).filter(
      (a) => a.kind === input.kind && signable(a),
    );
    const same = open.find((a) => a.summary === summary);
    if (same) return { action: actionView(same), intent: storedIntent(same), preview: null };
    const prepared = await calls.call("owner/prepare", { action, signer: "wallet" });
    if (!prepared.ok) {
      if (prepared.kind === "unknown") {
        const adopted =
          input.kind === "payout_vote"
            ? null
            : await adopt(organizationId, connection, calls, input.kind, built, actorId);
        if (adopted)
          return {
            action: actionView(await ownAction(organizationId, adopted)),
            intent: null,
            preview: null,
          };
        throw badRequest(
          "The MultiAgency platform's answer was lost and it shows nothing waiting. Try again.",
        );
      }
      if (prepared.kind === "refused" && prepared.code === "owner_action_open") {
        throw badRequest(
          "Another action of this kind is still open on the platform. Sign it or let it expire, then try again.",
        );
      }
      await deps.agents.accessFailed(organizationId, connection.consentId, prepared);
      throw platformError(prepared);
    }
    const { correlationId, confirm, intent, expiresAt, preview, policy } = prepared.value;
    const vote = input.kind === "payout_vote";
    if (vote && !confirm) {
      throw badRequest(
        "The platform couldn't show this payout's terms on its confirm page, so the vote isn't offered. Try again shortly.",
      );
    }
    const readable = !vote && intent?.standard === "nep413" ? intent : null;
    if (!confirm && !readable) {
      throw badRequest("The platform answered with something your wallet can't sign here");
    }
    for (const stale of open) await setStatus(stale.correlationId, "superseded");
    await record(organizationId, connection.agent, input.kind, {
      correlationId,
      summary,
      confirmUrl: confirm?.url ?? null,
      intent: readable ? JSON.stringify(readable) : null,
      expiresAt: new Date(confirm?.expiresAt ?? expiresAt),
      status: "prepared",
      requestedBy: actorId,
    });
    const [row] = await db
      .select()
      .from(platformOwnerActions)
      .where(eq(platformOwnerActions.correlationId, correlationId));
    if (!row) throw badRequest("The action couldn't be recorded");
    return {
      action: actionView(row),
      intent: readable,
      preview: {
        summary: preview.summary,
        before: policy?.current ?? null,
        after: policy?.requested ?? null,
      },
    };
  }

  function storedIntent(action: PlatformOwnerActionRow) {
    if (action.status !== "prepared" || !action.intent) return null;
    const parsed = nep413Intent.safeParse(JSON.parse(action.intent));
    return parsed.success ? parsed.data : null;
  }

  async function noteStatus(
    correlationId: string,
    status: { stage: string; status?: string; phase?: OwnerActionPhase },
  ) {
    if (status.phase === "open") return;
    await setStatus(correlationId, status.status ?? status.stage, status.phase);
  }

  async function setStatus(correlationId: string, status: string, phase?: OwnerActionPhase) {
    await db
      .update(platformOwnerActions)
      .set({ status, ...(phase ? { phase } : {}), updatedAt: now() })
      .where(eq(platformOwnerActions.correlationId, correlationId));
  }

  async function ownAction(organizationId: string, correlationId: string) {
    const [action] = await db
      .select()
      .from(platformOwnerActions)
      .where(
        and(
          eq(platformOwnerActions.correlationId, correlationId),
          eq(platformOwnerActions.organizationId, organizationId),
        ),
      );
    if (!action) throw badRequest("That action isn't this Organization's");
    return action;
  }

  async function submit(
    organizationId: string,
    input: { correlationId: string; signedData: Record<string, unknown> },
  ) {
    const { calls, connection } = await connected(organizationId, "owner");
    const action = await ownAction(organizationId, input.correlationId);
    if (action.status !== "prepared" || !action.intent || !signable(action)) {
      throw badRequest(
        "This action was already sent, or it's signed on the confirm page. Follow its status instead.",
      );
    }
    await setStatus(action.correlationId, "submitting");
    const submitted = await calls.call("owner/submit", {
      correlationId: action.correlationId,
      signedData: input.signedData,
    });
    if (submitted.ok) {
      await setStatus(action.correlationId, submitted.value.status, "submitted");
      return actionView(await ownAction(organizationId, action.correlationId));
    }
    if (submitted.kind === "unknown" || submitted.kind === "unavailable") {
      return follow(organizationId, action.correlationId);
    }
    const nothingSent =
      submitted.kind === "busy" ||
      submitted.kind === "unresolved" ||
      submitted.kind === "rate_limited";
    await setStatus(action.correlationId, nothingSent ? "prepared" : "refused");
    await deps.agents.accessFailed(organizationId, connection.consentId, submitted);
    throw platformError(submitted);
  }

  async function follow(organizationId: string, correlationId: string) {
    const { calls, connection } = await connected(organizationId, "owner");
    const action = await ownAction(organizationId, correlationId);
    const status = await answer(
      organizationId,
      connection,
      await calls.call("owner/status", { correlationId }),
    );
    await noteStatus(action.correlationId, status);
    return actionView(await ownAction(organizationId, correlationId));
  }

  async function followUnsettled() {
    let followed = 0;
    if (!deps.app) return followed;
    const rows = await db.select().from(platformOwnerActions);
    for (const action of rows.filter(isOpen)) {
      const connection = await deps.agents.connection(action.organizationId);
      if (!connection) continue;
      const status = await deps.app
        .agent(action.organizationId, connection.agent)
        .call("owner/status", { correlationId: action.correlationId });
      if (!status.ok) continue;
      await noteStatus(action.correlationId, status.value);
      followed += 1;
    }
    return followed;
  }

  async function grantReminders() {
    const reminders: Array<{ organizationId: string; expiresAt: Date }> = [];
    if (!deps.app) return reminders;
    const rows = await db.select().from(platformAgents);
    for (const row of rows) {
      const connection = await deps.agents.connection(row.organizationId);
      if (!connection) continue;
      const overview = await deps.app.agent(row.organizationId, connection.agent).call("overview");
      if (!overview.ok) continue;
      const latest = payoutGrants(overview.value)
        .map((g) => new Date(g.expires_at))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (!latest || latest.getTime() - now().getTime() >= GRANT_RENEW_DAYS * DAY_MS) continue;
      if (row.grantRemindedFor?.getTime() === latest.getTime()) continue;
      await db
        .update(platformAgents)
        .set({ grantRemindedFor: latest })
        .where(eq(platformAgents.organizationId, row.organizationId));
      reminders.push({ organizationId: row.organizationId, expiresAt: latest });
    }
    return reminders;
  }

  async function pendingPayees(organizationId: string) {
    const rules = await settingsOf(organizationId);
    if (!rules) return [];
    const { calls, connection } = await connected(organizationId, "read");
    const overview = await answer(organizationId, connection, await calls.call("overview"));
    const signed = overview.policy.policy;
    if (!signed) return [];
    const added = rulesChanges(rules, await deps.payees(organizationId), signed).changes;
    const agreed = new Set(signed.destinations.list.map((d) => d.address.toLowerCase()));
    return [...(added.withdrawals ?? []), ...(added.destinations ?? [])]
      .map((d) => d.address)
      .filter((address) => !agreed.has(address));
  }

  return {
    view,
    saveRules,
    prepare,
    submit,
    follow,
    followUnsettled,
    grantReminders,
    pendingPayees,
  };
}

export type PlatformOwnerActions = ReturnType<typeof createPlatformOwnerActions>;
