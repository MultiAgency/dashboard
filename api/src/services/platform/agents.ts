import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db";
import {
  type PlatformAgentRow,
  type PlatformConsentRow,
  platformAgents,
  platformConsents,
} from "../../db/schema";
import {
  type AppConsentSubmission,
  type AppRouteResult,
  appConsentSubmission,
  consentMessage,
  type OwnerResult,
  type PlatformApp,
  type PlatformConsent,
  type PlatformSettings,
  parseConsentMessage,
  parseSetupMessage,
  setupMessage,
} from "./client";
import {
  CONSENT_DAYS,
  CONSENT_SCOPES,
  type ConsentDays,
  nep413Intent,
  PLATFORM_AREA,
  type PLATFORM_REVOKED_REASONS,
  type PlatformAgentState,
} from "./terms";

const SIGNING_WINDOW_MS = 15 * 60_000;
const CONSENT_RENEW_MS = 14 * 86_400_000;

const CLEAR_PENDING = {
  pendingKind: null,
  pendingMessage: null,
  pendingNonce: null,
  pendingExpiresAt: null,
  pendingSubmission: null,
} satisfies Partial<PlatformAgentRow>;

const CLEAR_CREATE = {
  createCorrelationId: null,
  createConfirmUrl: null,
  createIntent: null,
  createExpiresAt: null,
  createStatus: null,
} satisfies Partial<PlatformAgentRow>;

const ACCESS_ENDED_CODES = new Set([
  "no_consent",
  "consent_revoked",
  "agent_changed",
  "owner_changed",
]);

type Failure = Extract<AppRouteResult<unknown> | OwnerResult<unknown>, { ok: false }>;
type RevokedReason = (typeof PLATFORM_REVOKED_REASONS)[number];

export const badRequest = (message: string) => new ORPCError("BAD_REQUEST", { message });

const UNAVAILABLE_MESSAGE =
  "Platform access isn't turned on for this server. Ask your MultiAgency operator to turn it on.";

function detail(failure: Failure): string {
  const text = "error" in failure ? failure.error : "";
  const code = "code" in failure && failure.code ? failure.code : null;
  return [code, text].filter(Boolean).join(": ");
}

export function failureMessage(failure: Failure): string {
  const extra = detail(failure);
  const withDetail = (message: string) => (extra ? `${message} (${extra})` : message);
  switch (failure.kind) {
    case "session":
      return "This server's access to the MultiAgency platform isn't working. Ask your MultiAgency operator.";
    case "unavailable":
      return "The MultiAgency platform didn't answer. Try again.";
    case "rate_limited":
      return `The MultiAgency platform is busy. Try again${
        failure.retryAfterSeconds ? ` in ${failure.retryAfterSeconds} seconds` : " shortly"
      }.`;
    case "forbidden":
      return withDetail("The MultiAgency platform refused access");
    case "unknown":
      return "The MultiAgency platform's answer was lost. Its outcome is being checked; don't sign again.";
    case "unresolved":
    case "busy":
      return withDetail("The agent is busy with another action. Try again shortly");
    case "provider":
      return withDetail("NEAR Intents refused it");
    default:
      return withDetail("The MultiAgency platform refused it");
  }
}

export const platformError = (failure: Failure) => badRequest(failureMessage(failure));

function accessOutcome(failure: Failure): "ended" | "unclear" | null {
  if (failure.kind !== "forbidden" || !failure.code) return null;
  if (ACCESS_ENDED_CODES.has(failure.code)) return "ended";
  return failure.code === "access_ended" ? "unclear" : null;
}

function exactSubmission(signed: AppConsentSubmission): AppConsentSubmission {
  return {
    message: signed.message,
    nonce: signed.nonce,
    publicKey: signed.publicKey,
    signature: signed.signature,
  };
}

function storedSubmission(row: PlatformAgentRow): AppConsentSubmission | null {
  if (!row.pendingSubmission) return null;
  const parsed = appConsentSubmission.safeParse(JSON.parse(row.pendingSubmission));
  return parsed.success ? parsed.data : null;
}

function signedBy(
  row: PlatformAgentRow,
  submission: AppConsentSubmission,
  remote: PlatformConsent,
) {
  if (remote.publicKey !== submission.publicKey || remote.organization !== row.organizationId) {
    return false;
  }
  if (row.pendingKind === "setup") {
    const setup = parseSetupMessage(submission.message);
    return !!setup && setup.owner === remote.owner && remote.agentId === "unborn";
  }
  const consent = parseConsentMessage(submission.message);
  return (
    !!consent &&
    consent.agent === remote.agent &&
    consent.agentId === remote.agentId &&
    Date.parse(consent.expiresAt) === remote.expiresAt
  );
}

export function createPlatformAgents(deps: {
  db: Database;
  app: PlatformApp | null;
  settings: PlatformSettings | null;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const available = deps.app !== null && deps.settings !== null;

  function requirePlatform(): { app: PlatformApp; settings: PlatformSettings } {
    if (!deps.app || !deps.settings) throw badRequest(UNAVAILABLE_MESSAGE);
    return { app: deps.app, settings: deps.settings };
  }

  async function load(organizationId: string): Promise<PlatformAgentRow | null> {
    const [row] = await db
      .select()
      .from(platformAgents)
      .where(eq(platformAgents.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  async function update(organizationId: string, patch: Partial<PlatformAgentRow>) {
    await db
      .update(platformAgents)
      .set({ ...patch, updatedAt: now() })
      .where(eq(platformAgents.organizationId, organizationId));
  }

  async function consentsOf(organizationId: string): Promise<PlatformConsentRow[]> {
    return db
      .select()
      .from(platformConsents)
      .where(eq(platformConsents.organizationId, organizationId));
  }

  async function markRevoked(organizationId: string, consentId: string, reason: RevokedReason) {
    await db
      .update(platformConsents)
      .set({ revokedAt: now(), revokedReason: reason })
      .where(
        and(
          eq(platformConsents.id, consentId),
          eq(platformConsents.organizationId, organizationId),
          isNull(platformConsents.revokedAt),
        ),
      );
  }

  function live(consent: PlatformConsentRow) {
    return consent.revokedAt === null && consent.expiresAt.getTime() > now().getTime();
  }

  function liveConsent(row: PlatformAgentRow, consents: PlatformConsentRow[]) {
    if (!row.agent || !row.agentId) return null;
    return (
      consents
        .filter(
          (c) =>
            c.kind === "consent" && c.agent === row.agent && c.agentId === row.agentId && live(c),
        )
        .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null
    );
  }

  function liveSetup(row: PlatformAgentRow, consents: PlatformConsentRow[]) {
    return consents.find((c) => c.kind === "setup" && c.agent === row.agent && live(c)) ?? null;
  }

  function pendingOpen(row: PlatformAgentRow) {
    return (
      !!row.pendingKind &&
      !!row.pendingExpiresAt &&
      row.pendingExpiresAt.getTime() > now().getTime() &&
      !row.pendingSubmission
    );
  }

  function pendingOf(row: PlatformAgentRow, kind: "setup" | "consent") {
    return row.pendingKind === kind && (pendingOpen(row) || !!row.pendingSubmission);
  }

  function stateOf(
    row: PlatformAgentRow | null,
    consents: PlatformConsentRow[],
  ): PlatformAgentState {
    if (!available) return "off";
    if (!row) return "not_connected";
    if (pendingOf(row, "setup")) return "setup_pending";
    if (!row.agent) return "not_connected";
    if (!row.agentId) return liveSetup(row, consents) ? "creating" : "setup_expired";
    if (liveConsent(row, consents)) return "connected";
    if (pendingOf(row, "consent")) return "consent_pending";
    return consents.some((c) => c.kind === "consent" && c.agentId === row.agentId)
      ? "ended"
      : "needs_consent";
  }

  async function readIdentity(row: PlatformAgentRow) {
    const { app } = requirePlatform();
    if (!row.agent) throw badRequest("Set up the platform agent first");
    const identity = await app.identity(row.agent);
    if (!identity.ok) return identity;
    const value = identity.value;
    if (
      value.owner !== row.ownerAccountId ||
      value.host !== row.host ||
      value.deployment !== row.deployment
    ) {
      throw badRequest(
        `The platform agent ${row.agent} belongs to ${value.owner} on ${value.deployment}@${value.host}, not ${row.ownerAccountId} on ${row.deployment}@${row.host}. Ask a site admin.`,
      );
    }
    if (value.signer === "dao") {
      throw badRequest(
        "This agent is owned by a DAO. Connecting DAO-owned agents isn't available in the dashboard yet.",
      );
    }
    return identity;
  }

  async function noteCreated(row: PlatformAgentRow): Promise<PlatformAgentRow> {
    const identity = await readIdentity(row);
    if (!identity.ok) return row;
    const { created, agentId } = identity.value;
    if (!created || !agentId || agentId === row.agentId) return row;
    const patch = {
      agentId,
      createStatus: row.createCorrelationId ? "created" : row.createStatus,
    };
    await update(row.organizationId, patch);
    return { ...row, ...patch };
  }

  async function recordSetup(
    row: PlatformAgentRow,
    submission: AppConsentSubmission,
    stored: { agent: string; consent: PlatformConsent },
    actorId: string,
  ) {
    await db
      .insert(platformConsents)
      .values({
        id: stored.consent.id,
        organizationId: row.organizationId,
        agent: stored.agent,
        agentId: stored.consent.agentId,
        kind: "setup",
        scopes: [...stored.consent.scopes].sort().join(","),
        expiresAt: new Date(stored.consent.expiresAt),
        publicKey: submission.publicKey,
        message: submission.message,
        createdBy: actorId,
      })
      .onConflictDoNothing();
    await update(row.organizationId, {
      ...CLEAR_PENDING,
      ...CLEAR_CREATE,
      agent: stored.agent,
      agentId: null,
      setupPublicKey: submission.publicKey,
      updatedBy: actorId,
    });
  }

  async function recordConsent(
    row: PlatformAgentRow,
    submission: AppConsentSubmission,
    consent: PlatformConsent,
    actorId: string,
  ) {
    await db
      .insert(platformConsents)
      .values({
        id: consent.id,
        organizationId: row.organizationId,
        agent: consent.agent,
        agentId: consent.agentId,
        kind: "consent",
        scopes: [...consent.scopes].sort().join(","),
        expiresAt: new Date(consent.expiresAt),
        publicKey: submission.publicKey,
        message: submission.message,
        createdBy: actorId,
      })
      .onConflictDoNothing();
    await update(row.organizationId, {
      ...CLEAR_PENDING,
      agentId: consent.agentId,
      updatedBy: actorId,
    });
  }

  async function listConsents(organizationId: string) {
    const { app } = requirePlatform();
    const listed = await app.consents.list(organizationId);
    if (!listed.ok) throw platformError(listed);
    return listed.value.consents.filter((c) => c.organization === organizationId);
  }

  async function reconcile(organizationId: string) {
    const remote = await listConsents(organizationId);
    const byId = new Map(remote.map((c) => [c.id, c]));
    const local = await consentsOf(organizationId);
    for (const consent of local.filter(live)) {
      if (byId.get(consent.id)?.revoked !== false) {
        await markRevoked(organizationId, consent.id, "access_ended");
      }
    }
    const row = await load(organizationId);
    const submission = row ? storedSubmission(row) : null;
    if (!row || !submission) return;
    const known = new Set(local.map((c) => c.id));
    const stored = remote.find(
      (c) =>
        !known.has(c.id) &&
        !c.revoked &&
        c.expiresAt > now().getTime() &&
        signedBy(row, submission, c),
    );
    if (!stored) return;
    if (row.pendingKind === "setup") {
      await recordSetup(row, submission, { agent: stored.agent, consent: stored }, row.updatedBy);
    } else {
      await recordConsent(row, submission, stored, row.updatedBy);
    }
  }

  async function view(organizationId: string) {
    let row = available ? await load(organizationId) : null;
    let readError: string | null = null;
    try {
      if (row?.pendingSubmission) {
        await reconcile(organizationId);
        row = await load(organizationId);
      }
      if (row?.agent && !row.agentId) row = await noteCreated(row);
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    const consents = row ? await consentsOf(organizationId) : [];
    const current = row ? liveConsent(row, consents) : null;
    const signing =
      row && pendingOpen(row) && row.pendingKind && row.pendingMessage && row.pendingNonce
        ? {
            kind: row.pendingKind,
            message: row.pendingMessage,
            recipient: row.host,
            nonce: row.pendingNonce,
            expiresAt: row.pendingExpiresAt?.toISOString() ?? "",
          }
        : null;
    return {
      available,
      unavailableReason: available ? null : UNAVAILABLE_MESSAGE,
      state: stateOf(row, consents),
      host: deps.settings?.host ?? null,
      ownerAccountId: row?.ownerAccountId ?? null,
      agent: row?.agent ?? null,
      agentId: row?.agentId ?? null,
      setupPublicKey: row?.setupPublicKey ?? null,
      signing,
      retryable: !!row?.pendingSubmission,
      create:
        row?.createCorrelationId && !row.agentId
          ? {
              correlationId: row.createCorrelationId,
              confirmUrl: row.createConfirmUrl && openCreate(row) ? row.createConfirmUrl : null,
              expiresAt: row.createExpiresAt?.toISOString() ?? null,
              status: row.createStatus,
            }
          : null,
      consent: current
        ? {
            id: current.id,
            scopes: current.scopes.split(","),
            expiresAt: current.expiresAt.toISOString(),
            expiringSoon: current.expiresAt.getTime() - now().getTime() < CONSENT_RENEW_MS,
          }
        : null,
      consents: consents
        .filter((c) => c.kind === "consent")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({
          id: c.id,
          scopes: c.scopes.split(","),
          expiresAt: c.expiresAt.toISOString(),
          revokedAt: c.revokedAt?.toISOString() ?? null,
          revokedReason: c.revokedReason ?? null,
          createdAt: c.createdAt.toISOString(),
        })),
      consentDays: [...CONSENT_DAYS],
      payoutRoute: row?.payoutRoute ?? "legacy",
      error: readError,
    };
  }

  async function issueNonce(app: PlatformApp) {
    const issued = await app.consents.nonce();
    if (!issued.ok) throw platformError(issued);
    return issued.value.nonce;
  }

  async function adoptReservation(
    organizationId: string,
    owner: string,
    actorId: string,
  ): Promise<PlatformAgentRow | null> {
    const { app } = requirePlatform();
    const reserved = await app.reservations({
      organization: organizationId,
      owner,
      area: PLATFORM_AREA,
    });
    if (!reserved.ok) throw platformError(reserved);
    const found = reserved.value.agents.find(
      (a) =>
        a.organization === organizationId &&
        a.owner === owner &&
        a.area === PLATFORM_AREA &&
        !a.released,
    );
    if (!found) return null;
    await update(organizationId, {
      ...CLEAR_PENDING,
      agent: found.agent,
      ownerAccountId: owner,
      updatedBy: actorId,
    });
    const row = await load(organizationId);
    return row ? noteCreated(row) : null;
  }

  async function startSetup(
    organizationId: string,
    actorId: string,
    input: { ownerAccountId: string },
  ) {
    const { app, settings } = requirePlatform();
    const owner = input.ownerAccountId;
    const existing = await load(organizationId);
    if (existing?.agentId) {
      throw badRequest(
        `This Organization already has a platform agent, owned by ${existing.ownerAccountId}`,
      );
    }
    const ownerChanged = !!existing && existing.ownerAccountId !== owner;
    const base = {
      ownerAccountId: owner,
      area: PLATFORM_AREA,
      host: settings.host,
      deployment: settings.deployment,
      updatedBy: actorId,
      ...(ownerChanged && { ...CLEAR_CREATE, agent: null, setupPublicKey: null }),
    };
    if (existing) await update(organizationId, base);
    else await db.insert(platformAgents).values({ organizationId, ...base });

    const adopted = await adoptReservation(organizationId, owner, actorId);
    if (adopted?.agentId) return view(organizationId);

    const expiresAt = new Date(now().getTime() + SIGNING_WINDOW_MS);
    const message = setupMessage({
      host: settings.host,
      deployment: settings.deployment,
      organization: organizationId,
      owner,
      area: PLATFORM_AREA,
      expiresAt: expiresAt.toISOString(),
    });
    const nonce = await issueNonce(app);
    await update(organizationId, {
      ...CLEAR_PENDING,
      pendingKind: "setup",
      pendingMessage: message,
      pendingNonce: nonce,
      pendingExpiresAt: expiresAt,
    });
    return view(organizationId);
  }

  async function startConsent(
    organizationId: string,
    actorId: string,
    input: { days: ConsentDays; payout?: boolean },
  ) {
    const { app, settings } = requirePlatform();
    const row = await load(organizationId);
    if (!row?.agent) throw badRequest("Set up the platform agent first");
    const identity = await readIdentity(row);
    if (!identity.ok) throw platformError(identity);
    const { agentId, created } = identity.value;
    if (!created || !agentId) throw badRequest("The platform agent isn't created yet");
    const message = consentMessage({
      host: settings.host,
      deployment: settings.deployment,
      organization: organizationId,
      owner: row.ownerAccountId,
      agent: row.agent,
      agentId,
      scopes: input.payout ? [...CONSENT_SCOPES, "payout"] : [...CONSENT_SCOPES],
      expiresAt: new Date(now().getTime() + input.days * 86_400_000).toISOString(),
    });
    const nonce = await issueNonce(app);
    await update(organizationId, {
      ...CLEAR_PENDING,
      agentId,
      pendingKind: "consent",
      pendingMessage: message,
      pendingNonce: nonce,
      pendingExpiresAt: new Date(now().getTime() + SIGNING_WINDOW_MS),
      updatedBy: actorId,
    });
    return view(organizationId);
  }

  async function send(row: PlatformAgentRow, submission: AppConsentSubmission, actorId: string) {
    const { app } = requirePlatform();
    if (row.pendingKind === "setup") {
      const result = await app.setup(submission);
      if (result.ok) return recordSetup(row, submission, result.value, actorId);
      if (result.kind === "refused" && result.code === "already_created") {
        const adopted = await adoptReservation(row.organizationId, row.ownerAccountId, actorId);
        if (adopted?.agent) return;
      }
      await settleFailure(row.organizationId, result);
      throw platformError(result);
    }
    const result = await app.consents.submit(submission);
    if (result.ok) return recordConsent(row, submission, result.value.consent, actorId);
    await settleFailure(row.organizationId, result);
    throw platformError(result);
  }

  async function settleFailure(organizationId: string, failure: Failure) {
    if (failure.kind === "unavailable" || failure.kind === "rate_limited") return;
    await update(organizationId, CLEAR_PENDING);
  }

  async function submitSigned(
    organizationId: string,
    actorId: string,
    signed: AppConsentSubmission,
  ) {
    requirePlatform();
    const row = await load(organizationId);
    if (!row || !pendingOpen(row) || !row.pendingKind) {
      throw badRequest("Nothing is waiting for a signature. Start again.");
    }
    const submission = exactSubmission(signed);
    const parsed =
      row.pendingKind === "setup"
        ? parseSetupMessage(submission.message)
        : parseConsentMessage(submission.message);
    if (
      submission.message !== row.pendingMessage ||
      submission.nonce !== row.pendingNonce ||
      !parsed ||
      parsed.organization !== organizationId ||
      parsed.owner !== row.ownerAccountId
    ) {
      throw badRequest("That isn't the text this dashboard asked you to sign. Start again.");
    }
    await update(organizationId, { pendingSubmission: JSON.stringify(submission) });
    await send(row, submission, actorId);
    return view(organizationId);
  }

  async function retry(organizationId: string, actorId: string) {
    requirePlatform();
    const row = await load(organizationId);
    const submission = row ? storedSubmission(row) : null;
    if (!row?.pendingKind || !submission) throw badRequest("Nothing to send again");
    await send(row, submission, actorId);
    return view(organizationId);
  }

  function openCreate(row: PlatformAgentRow) {
    return (
      !!row.createCorrelationId &&
      row.createStatus !== "refused" &&
      !!row.createExpiresAt &&
      row.createExpiresAt.getTime() > now().getTime()
    );
  }

  function storedIntent(row: PlatformAgentRow) {
    if (row.createStatus !== "prepared" || !row.createIntent) return null;
    const parsed = nep413Intent.safeParse(JSON.parse(row.createIntent));
    return parsed.success ? parsed.data : null;
  }

  async function prepareCreate(organizationId: string, actorId: string) {
    const { app } = requirePlatform();
    const row = await load(organizationId);
    if (!row?.agent || !row.setupPublicKey) throw badRequest("Set up the platform agent first");
    if (row.agentId) throw badRequest("The platform agent is already created");
    if (openCreate(row)) return { view: await view(organizationId), intent: storedIntent(row) };
    const identity = await readIdentity(row);
    if (!identity.ok) throw platformError(identity);
    if (identity.value.created) {
      await noteCreated(row);
      return { view: await view(organizationId), intent: null };
    }
    const prepared = await app.agent(organizationId, row.agent).call("owner/prepare", {
      action: {
        type: "agent_create",
        owner: { type: "near", account_id: row.ownerAccountId, public_key: row.setupPublicKey },
        role: "payout",
      },
      signer: "wallet",
    });
    if (!prepared.ok) {
      const maybeOpen =
        prepared.kind === "unknown" ||
        (prepared.kind === "refused" && prepared.code === "owner_action_open");
      if (maybeOpen && (await adoptOpenCreate(organizationId, row.agent, actorId))) {
        return { view: await view(organizationId), intent: null };
      }
      if (prepared.kind === "unknown") {
        throw badRequest(
          "The MultiAgency platform's answer was lost and it shows no creation waiting. Try again.",
        );
      }
      throw platformError(prepared);
    }
    const { correlationId, confirm, intent, expiresAt } = prepared.value;
    const readable = intent?.standard === "nep413" ? intent : null;
    if (!confirm && !readable) {
      throw badRequest("The platform answered with something your wallet can't sign here");
    }
    await update(organizationId, {
      createCorrelationId: correlationId,
      createConfirmUrl: confirm?.url ?? null,
      createIntent: readable ? JSON.stringify(readable) : null,
      createExpiresAt: new Date(confirm?.expiresAt ?? expiresAt),
      createStatus: "prepared",
      updatedBy: actorId,
    });
    return { view: await view(organizationId), intent: readable };
  }

  async function adoptOpenCreate(organizationId: string, agent: string, actorId: string) {
    const { app } = requirePlatform();
    const actions = await app.agent(organizationId, agent).call("owner/actions");
    if (!actions.ok) throw platformError(actions);
    const open = actions.value.find(
      (a) =>
        a.type === "agent_create" &&
        a.signer === "wallet" &&
        (a.stage === "prepared" || a.stage === "submitted") &&
        Date.parse(a.expiresAt) > now().getTime(),
    );
    if (!open) return false;
    await update(organizationId, {
      ...CLEAR_CREATE,
      createCorrelationId: open.correlationId,
      createExpiresAt: new Date(open.expiresAt),
      createStatus: open.stage === "prepared" ? "adopted" : "submitted",
      updatedBy: actorId,
    });
    return true;
  }

  async function submitCreate(
    organizationId: string,
    input: { correlationId: string; signedData: Record<string, unknown> },
  ) {
    const { app } = requirePlatform();
    const row = await load(organizationId);
    if (!row?.agent || row.createCorrelationId !== input.correlationId) {
      throw badRequest("That creation isn't the one waiting here. Start again.");
    }
    if (row.createStatus !== "prepared") {
      throw badRequest("This creation was already sent. Follow its status instead.");
    }
    await update(organizationId, { createStatus: "submitting" });
    const submitted = await app.agent(organizationId, row.agent).call("owner/submit", {
      correlationId: input.correlationId,
      signedData: input.signedData,
    });
    if (submitted.ok) {
      await update(organizationId, { createStatus: submitted.value.status });
      return view(organizationId);
    }
    if (submitted.kind === "unknown" || submitted.kind === "unavailable") {
      return followCreate(organizationId);
    }
    const nothingSent =
      submitted.kind === "busy" ||
      submitted.kind === "unresolved" ||
      submitted.kind === "rate_limited";
    await update(organizationId, { createStatus: nothingSent ? "prepared" : "refused" });
    throw platformError(submitted);
  }

  async function followCreate(organizationId: string) {
    const { app } = requirePlatform();
    const row = await load(organizationId);
    if (!row?.agent || !row.createCorrelationId) return view(organizationId);
    const status = await app
      .agent(organizationId, row.agent)
      .call("owner/status", { correlationId: row.createCorrelationId });
    if (status.ok) {
      await update(organizationId, { createStatus: status.value.status ?? status.value.stage });
    }
    await noteCreated((await load(organizationId)) ?? row);
    return view(organizationId);
  }

  async function revokeAll(organizationId: string, reason: RevokedReason) {
    const { app } = requirePlatform();
    const remote = await listConsents(organizationId);
    for (const consent of remote.filter((c) => !c.revoked && c.expiresAt > now().getTime())) {
      const revoked = await app.consents.revoke(consent.id);
      if (!revoked.ok && revoked.kind !== "refused") throw platformError(revoked);
      await markRevoked(organizationId, consent.id, reason);
    }
    for (const consent of (await consentsOf(organizationId)).filter(live)) {
      await markRevoked(organizationId, consent.id, "access_ended");
    }
    await update(organizationId, CLEAR_PENDING);
  }

  async function disconnect(organizationId: string, actorId: string) {
    await revokeAll(organizationId, "dashboard");
    await update(organizationId, { updatedBy: actorId });
    return view(organizationId);
  }

  async function beforeOrganizationRemoved(organizationId: string) {
    if (!(await load(organizationId))) return;
    if (!available) {
      throw new Error(
        `${organizationId} has a platform agent, and platform access isn't configured here to revoke its consents`,
      );
    }
    await revokeAll(organizationId, "organization_deleted");
  }

  async function maintain(
    organizationExists: ((organizationId: string) => Promise<boolean>) | null,
  ) {
    const result = { checked: 0, revoked: 0, failed: [] as string[] };
    if (!available) return result;
    const rows = await db.select().from(platformAgents);
    for (const row of rows) {
      result.checked += 1;
      try {
        if (organizationExists && !(await organizationExists(row.organizationId))) {
          await revokeAll(row.organizationId, "organization_deleted");
          await db
            .delete(platformAgents)
            .where(eq(platformAgents.organizationId, row.organizationId));
          result.revoked += 1;
        } else if (row.pendingSubmission || (await consentsOf(row.organizationId)).some(live)) {
          await reconcile(row.organizationId);
        }
      } catch (error) {
        console.warn(`[API] platform upkeep for ${row.organizationId} failed:`, error);
        result.failed.push(row.organizationId);
      }
    }
    return result;
  }

  async function connection(organizationId: string) {
    if (!available) return null;
    const row = await load(organizationId);
    if (!row?.agent || !row.agentId) return null;
    const current = liveConsent(row, await consentsOf(organizationId));
    if (!current) return null;
    return {
      agent: row.agent,
      agentId: row.agentId,
      consentId: current.id,
      scopes: current.scopes.split(","),
    };
  }

  async function accessFailed(organizationId: string, consentId: string, failure: Failure) {
    const outcome = accessOutcome(failure);
    if (outcome === "ended") await markRevoked(organizationId, consentId, "access_ended");
    if (outcome === "unclear") await reconcile(organizationId).catch(() => undefined);
  }

  return {
    available,
    view,
    startSetup,
    startConsent,
    submitSigned,
    retry,
    prepareCreate,
    submitCreate,
    followCreate,
    disconnect,
    beforeOrganizationRemoved,
    maintain,
    connection,
    accessFailed,
  };
}

export type PlatformAgents = ReturnType<typeof createPlatformAgents>;
