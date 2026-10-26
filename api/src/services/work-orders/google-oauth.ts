import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Database } from "../../db";
import { googleOauthStates, workOrderIntegrations } from "../../db/schema";
import { open, seal } from "../payouts/crypto";
import { createGoogle, GoogleError, type GooglePort } from "./google";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", DRIVE_FILE_SCOPE].join(" ");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;
const BROKEN = "Google Drive access was revoked or has expired. Reconnect Google Drive.";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  secretKey: string | null;
  pickerApiKey: string | null;
  projectNumber: string | null;
};

export class GoogleConnectError extends Error {}

const hashState = (state: string) => createHash("sha256").update(state, "utf8").digest("hex");

function emailOfIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export function createGoogleConnections(deps: {
  db: Database;
  config: GoogleOAuthConfig | null;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const { db, config } = deps;
  const fetcher = deps.fetcher ?? fetch;
  const now = () => deps.now?.() ?? new Date();
  const cache = new Map<string, { sealed: string; token: string; expiresAt: number }>();

  async function row(organizationId: string) {
    const [found] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, organizationId))
      .limit(1);
    return found ?? null;
  }

  async function tokenRequest(params: Record<string, string>) {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    return { ok: response.ok, status: response.status, body };
  }

  function ready(): GoogleOAuthConfig & { secretKey: string } {
    if (!config) throw new GoogleConnectError("Google sign-in isn't set up on this server");
    if (!config.secretKey) {
      throw new GoogleConnectError(
        "Set PAYOUTS_SECRET_KEY (or GOOGLE_TOKENS_SECRET_KEY) on the server so MultiAgency can store the Google connection encrypted",
      );
    }
    return { ...config, secretKey: config.secretKey };
  }

  async function markBroken(organizationId: string) {
    cache.delete(organizationId);
    await db
      .update(workOrderIntegrations)
      .set({ googleOauthError: BROKEN })
      .where(eq(workOrderIntegrations.organizationId, organizationId));
  }

  async function accessToken(
    organizationId: string,
  ): Promise<{ token: string; expiresAt: number }> {
    const settings = ready();
    const current = await row(organizationId);
    if (!current?.googleOauthToken) throw new GoogleError("Google Drive isn't connected", 401);
    if (current.googleOauthError) throw new GoogleError(current.googleOauthError, 401);
    const cached = cache.get(organizationId);
    if (
      cached &&
      cached.sealed === current.googleOauthToken &&
      cached.expiresAt > now().getTime() + 60_000
    ) {
      return { token: cached.token, expiresAt: cached.expiresAt };
    }
    let refreshToken: string;
    try {
      refreshToken = open(current.googleOauthToken, settings.secretKey);
    } catch {
      await markBroken(organizationId);
      throw new GoogleError(BROKEN, 401);
    }
    const { ok, status, body } = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    });
    if (!ok || !body.access_token) {
      if (body.error === "invalid_grant" || body.error === "unauthorized_client") {
        await markBroken(organizationId);
        throw new GoogleError(BROKEN, 401);
      }
      throw new GoogleError(
        `Google Drive sign-in failed: ${body.error_description ?? body.error ?? status}`,
        status,
      );
    }
    const entry = {
      sealed: current.googleOauthToken,
      token: body.access_token,
      expiresAt: now().getTime() + (body.expires_in ?? 3600) * 1000,
    };
    cache.set(organizationId, entry);
    return { token: entry.token, expiresAt: entry.expiresAt };
  }

  return {
    available: config !== null,
    canConnect: !!config?.secretKey,
    picker: config?.pickerApiKey
      ? {
          apiKey: config.pickerApiKey,
          clientId: config.clientId,
          appId: config.projectNumber,
        }
      : null,
    redirectUri: config?.redirectUri ?? null,

    status: async (organizationId: string) => {
      const current = await row(organizationId);
      return {
        connected: !!current?.googleOauthToken,
        email: current?.googleOauthToken ? (current.googleOauthEmail ?? null) : null,
        error: current?.googleOauthToken ? (current.googleOauthError ?? null) : null,
        connectedAt: current?.googleOauthConnectedAt ?? null,
      };
    },

    start: async (organizationId: string, userId: string) => {
      const settings = ready();
      const state = randomBytes(32).toString("base64url");
      await db.delete(googleOauthStates).where(lt(googleOauthStates.expiresAt, now()));
      await db.insert(googleOauthStates).values({
        stateHash: hashState(state),
        organizationId,
        userId,
        expiresAt: new Date(now().getTime() + STATE_TTL_MS),
        createdAt: now(),
      });
      const params = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return `${AUTH_URL}?${params}`;
    },

    finish: async (input: {
      code?: string | null;
      state?: string | null;
      error?: string | null;
    }): Promise<{ organizationId: string; email: string | null }> => {
      const settings = ready();
      if (!input.state) throw new GoogleConnectError("The Google sign-in link is incomplete");
      const [pending] = await db
        .delete(googleOauthStates)
        .where(
          and(
            eq(googleOauthStates.stateHash, hashState(input.state)),
            gt(googleOauthStates.expiresAt, now()),
          ),
        )
        .returning();
      if (!pending) {
        throw new GoogleConnectError("The Google sign-in link expired. Start again from Settings");
      }
      if (input.error) {
        throw new GoogleConnectError(
          input.error === "access_denied"
            ? "Google Drive wasn't connected: access was declined"
            : `Google sign-in failed: ${input.error}`,
        );
      }
      if (!input.code) throw new GoogleConnectError("Google didn't return a sign-in code");
      const { ok, body } = await tokenRequest({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: settings.redirectUri,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      });
      if (!ok || !body.access_token) {
        throw new GoogleConnectError(
          `Google sign-in failed: ${body.error_description ?? body.error ?? "no access token"}`,
        );
      }
      if (!(body.scope ?? "").split(" ").includes(DRIVE_FILE_SCOPE)) {
        throw new GoogleConnectError(
          "Google Drive wasn't connected: allow MultiAgency to see and edit the Drive files it uses",
        );
      }
      if (!body.refresh_token) {
        throw new GoogleConnectError(
          "Google didn't return a lasting connection. Remove MultiAgency from your Google account's third-party access and connect again",
        );
      }
      const email = emailOfIdToken(body.id_token);
      const sealed = seal(body.refresh_token, settings.secretKey);
      const values = {
        googleOauthToken: sealed,
        googleOauthEmail: email,
        googleOauthError: null,
        googleOauthConnectedAt: now(),
        googleOauthConnectedBy: pending.userId,
        updatedBy: pending.userId,
        updatedAt: now(),
      };
      const updated = await db
        .update(workOrderIntegrations)
        .set(values)
        .where(eq(workOrderIntegrations.organizationId, pending.organizationId))
        .returning({ organizationId: workOrderIntegrations.organizationId });
      if (updated.length === 0) {
        await db.insert(workOrderIntegrations).values({
          organizationId: pending.organizationId,
          webhookSecret: randomBytes(32).toString("hex"),
          inboundTokenHash: hashState(`wo_${randomBytes(32).toString("base64url")}`),
          ...values,
        });
      }
      cache.set(pending.organizationId, {
        sealed,
        token: body.access_token,
        expiresAt: now().getTime() + (body.expires_in ?? 3600) * 1000,
      });
      return { organizationId: pending.organizationId, email };
    },

    disconnect: async (organizationId: string) => {
      const current = await row(organizationId);
      cache.delete(organizationId);
      if (!current?.googleOauthToken) return;
      if (config?.secretKey) {
        try {
          const token = open(current.googleOauthToken, config.secretKey);
          await fetcher(`${REVOKE_URL}?${new URLSearchParams({ token })}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {}
      }
      await db
        .update(workOrderIntegrations)
        .set({
          googleOauthToken: null,
          googleOauthEmail: null,
          googleOauthError: null,
          googleOauthConnectedAt: null,
          googleOauthConnectedBy: null,
        })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
    },

    accessToken,

    port: async (organizationId: string): Promise<GooglePort | null> => {
      if (!config?.secretKey) return null;
      const current = await row(organizationId);
      if (!current?.googleOauthToken || current.googleOauthError) return null;
      return createGoogle(
        {
          kind: "oauth",
          email: current.googleOauthEmail ?? "your Google account",
          token: async () => (await accessToken(organizationId)).token,
        },
        fetcher,
      );
    },
  };
}

export type GoogleConnections = ReturnType<typeof createGoogleConnections>;
