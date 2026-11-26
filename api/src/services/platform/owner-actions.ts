import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db";
import { type PlatformOwnerActionRow, platformAgents, platformOwnerActions } from "../../db/schema";
import { badRequest, type PlatformAgents, platformError } from "./agents";
import type { AppOwnerAction, OwnerResult, PlatformApp } from "./client";
import { type PayoutRules, rulesChanges } from "./rules";
import { GRANT_DAYS, GRANT_RENEW_DAYS, nep413Intent, type OwnerActionKind } from "./terms";

const DAY_MS = 86_400_000;
const OPEN = new Set(["prepared", "adopted", "submitting", "submitted"]);
const ACTION_TYPES: Record<OwnerActionKind, AppOwnerAction["type"]> = {
  rules: "policy_update",
  grant: "grant_issue",
  grant_revoke: "grant_revoke",
  freeze: "agent_freeze",
  unfreeze: "agent_unfreeze",
};
const SUMMARIES: Record<Exclude<OwnerActionKind, "rules">, string> = {
  grant: `Let MultiAgency pay within these rules for ${GRANT_DAYS} days`,
  grant_revoke: "Stop MultiAgency paying under permission",
  freeze: "Freeze the agent: it pays nothing until unfrozen",
  unfreeze: "Unfreeze the agent",
};

type AgentCalls = ReturnType<PlatformApp["agent"]>;
type Connection = NonNullable<Awaited<ReturnType<PlatformAgents["connection"]>>>;

export function createPlatformOwnerActions(deps: {
  db: Database;
  app: PlatformApp | null;
  agents: PlatformAgents;
  payees: (organizationId: string) => Promise<string[]>;
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
      })
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    return row?.asset && row.maxPerPayout && row.monthlyBudgetUsd
      ? { asset: row.asset, maxPerPayout: row.maxPerPayout, monthlyBudgetUsd: row.monthlyBudgetUsd }
      : null;
  }

  async function actionsOf(organizationId: string) {
    return db
      .select()
      .from(platformOwnerActions)
      .where(eq(platformOwnerActions.organizationId, organizationId))
      .orderBy(desc(platformOwnerActions.createdAt));
  }

  function isOpen(action: PlatformOwnerActionRow) {
    return OPEN.has(action.status) && action.expiresAt.getTime() > now().getTime();
  }

  function actionView(action: PlatformOwnerActionRow) {
    const open = isOpen(action);
    return {
      correlationId: action.correlationId,
      kind: action.kind,
      summary: action.summary,
      status: action.status,
      open,
      confirmUrl: open ? action.confirmUrl : null,
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
    input: { kind: OwnerActionKind; grantId?: string },
  ): Promise<{ action: AppOwnerAction; summary: string }> {
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
    summary: string,
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
      summary: `${summary} (its answer was lost; recovered from the platform)`,
      expiresAt: new Date(open.expiresAt),
      status: open.stage === "prepared" ? "adopted" : "submitted",
      requestedBy: actorId,
    });
    return open.correlationId;
  }

  async function prepare(
    organizationId: string,
    actorId: string,
    input: { kind: OwnerActionKind; grantId?: string },
  ) {
    const { calls, connection } = await connected(organizationId, "owner");
    const { action, summary } = await build(organizationId, connection, calls, input);
    const open = (await actionsOf(organizationId)).filter(
      (a) => a.kind === input.kind && isOpen(a),
    );
    const same = open.find((a) => a.summary === summary);
    if (same) return { action: actionView(same), intent: storedIntent(same), preview: null };
    const prepared = await calls.call("owner/prepare", { action, signer: "wallet" });
    if (!prepared.ok) {
      if (prepared.kind === "unknown") {
        const adopted = await adopt(
          organizationId,
          connection,
          calls,
          input.kind,
          summary,
          actorId,
        );
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
    const readable = intent?.standard === "nep413" ? intent : null;
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

  async function setStatus(correlationId: string, status: string) {
    await db
      .update(platformOwnerActions)
      .set({ status, updatedAt: now() })
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
    if (action.status !== "prepared" || !action.intent || !isOpen(action)) {
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
      await setStatus(action.correlationId, submitted.value.status);
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
    if (status.phase !== "open") {
      await setStatus(action.correlationId, status.status ?? status.stage);
    }
    return actionView(await ownAction(organizationId, correlationId));
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

  return { view, saveRules, prepare, submit, follow, grantReminders };
}

export type PlatformOwnerActions = ReturnType<typeof createPlatformOwnerActions>;
