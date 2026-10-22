import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { Database } from "../../db";
import {
  type WorkOrderIntegrationRow,
  type WorkOrderOutboxRow,
  workOrderDriveFiles,
  workOrderIntegrations,
  workOrderOutbox,
} from "../../db/schema";
import type { EmailSender } from "../notify";
import { composeEmails, emailHtml, type WorkOrderEmail } from "./emails";
import { signEvent, type WorkOrderEvent } from "./events";

const FIRST_RETRY_MS = 60_000;
const MAX_RETRY_MS = 3_600_000;
const GIVE_UP_MS = 24 * 3_600_000;
const BATCH = 50;
const N8N_TIMEOUT_MS = 15_000;

export type HttpPost = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number }>;

export const fetchPost: HttpPost = async (url, body, headers) => {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
  });
  return { status: response.status };
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newSecret(): string {
  return randomBytes(32).toString("hex");
}

function newToken(): string {
  return `wo_${randomBytes(32).toString("base64url")}`;
}

export function createWorkOrderIntegrations(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function settings(organizationId: string): Promise<WorkOrderIntegrationRow | null> {
    const [row] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  async function issue(organizationId: string, actorId: string, webhookUrl: string | null) {
    const token = newToken();
    const values = {
      organizationId,
      n8nWebhookUrl: webhookUrl,
      webhookSecret: newSecret(),
      inboundTokenHash: hashToken(token),
      updatedBy: actorId,
      updatedAt: now(),
    };
    await db
      .insert(workOrderIntegrations)
      .values(values)
      .onConflictDoUpdate({ target: workOrderIntegrations.organizationId, set: values });
    return token;
  }

  return {
    settings,

    save: async (organizationId: string, actorId: string, webhookUrl: string | null) => {
      const existing = await settings(organizationId);
      if (!existing) return { inboundToken: await issue(organizationId, actorId, webhookUrl) };
      await db
        .update(workOrderIntegrations)
        .set({ n8nWebhookUrl: webhookUrl, updatedBy: actorId, updatedAt: now() })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
      return { inboundToken: null };
    },

    rotate: async (organizationId: string, actorId: string) => {
      const existing = await settings(organizationId);
      return {
        inboundToken: await issue(organizationId, actorId, existing?.n8nWebhookUrl ?? null),
      };
    },

    organizationOfToken: async (token: string): Promise<string | null> => {
      if (!/^wo_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
      const [row] = await db
        .select({ organizationId: workOrderIntegrations.organizationId })
        .from(workOrderIntegrations)
        .where(eq(workOrderIntegrations.inboundTokenHash, hashToken(token)))
        .limit(1);
      return row?.organizationId ?? null;
    },

    saveGoogle: async (
      organizationId: string,
      actorId: string,
      input: {
        templateId: string | null;
        documentsFolderId: string | null;
        signedFolderId: string | null;
      },
    ) => {
      if (!(await settings(organizationId))) await issue(organizationId, actorId, null);
      await db
        .update(workOrderIntegrations)
        .set({
          googleTemplateId: input.templateId,
          googleDocumentsFolderId: input.documentsFolderId,
          googleSignedFolderId: input.signedFolderId,
          googleLastError: null,
          updatedBy: actorId,
          updatedAt: now(),
        })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
    },

    driveFiles: async (organizationId: string, limit = 20) =>
      db
        .select()
        .from(workOrderDriveFiles)
        .where(eq(workOrderDriveFiles.organizationId, organizationId))
        .orderBy(desc(workOrderDriveFiles.processedAt))
        .limit(limit),

    recent: async (organizationId: string, limit = 20) =>
      db
        .select()
        .from(workOrderOutbox)
        .where(eq(workOrderOutbox.organizationId, organizationId))
        .orderBy(desc(workOrderOutbox.createdAt))
        .limit(limit),
  };
}

export type WorkOrderIntegrations = ReturnType<typeof createWorkOrderIntegrations>;

export function createWorkOrderOutbox(deps: {
  db: Database;
  integrations: WorkOrderIntegrations;
  sendEmail: EmailSender | null;
  post?: HttpPost;
  immediate?: boolean;
  now?: () => Date;
}) {
  const { db, integrations, sendEmail } = deps;
  const post = deps.post ?? fetchPost;
  const now = () => deps.now?.() ?? new Date();

  async function attempt(row: WorkOrderOutboxRow): Promise<boolean> {
    const attempts = row.attempts + 1;
    const retry = async (error: string) => {
      const delay = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
      await db
        .update(workOrderOutbox)
        .set({ attempts, lastError: error, nextAttemptAt: new Date(now().getTime() + delay) })
        .where(eq(workOrderOutbox.id, row.id));
      console.warn(`[API] work order ${row.channel} ${row.eventType} not delivered: ${error}`);
      return false;
    };
    try {
      if (row.channel === "email") {
        if (!sendEmail) return retry("email is not configured (RESEND_API_KEY, NOTIFY_FROM_EMAIL)");
        const email = JSON.parse(row.payload) as WorkOrderEmail;
        await sendEmail({ to: email.to, subject: email.subject, html: emailHtml(email.text) });
      } else {
        const settings = await integrations.settings(row.organizationId);
        if (!settings?.n8nWebhookUrl) return retry("n8n is not connected for this Agency");
        const { status } = await post(settings.n8nWebhookUrl, row.payload, {
          "Content-Type": "application/json",
          "X-AP-Event": row.eventType,
          "X-AP-Signature": signEvent(row.payload, settings.webhookSecret),
        });
        if (status < 200 || status >= 300) return retry(`n8n answered ${status}`);
      }
      await db
        .update(workOrderOutbox)
        .set({ attempts, deliveredAt: now(), lastError: null })
        .where(eq(workOrderOutbox.id, row.id));
      return true;
    } catch (error) {
      return retry(error instanceof Error ? error.message : String(error));
    }
  }

  async function deliver(filter: { ids?: string[] } = {}) {
    const conditions = [
      isNull(workOrderOutbox.deliveredAt),
      lte(workOrderOutbox.nextAttemptAt, now()),
      gt(workOrderOutbox.createdAt, new Date(now().getTime() - GIVE_UP_MS)),
    ];
    if (filter.ids) {
      if (filter.ids.length === 0) return { delivered: 0, failed: 0 };
      conditions.push(inArray(workOrderOutbox.id, filter.ids));
    }
    const rows = await db
      .select()
      .from(workOrderOutbox)
      .where(and(...conditions))
      .orderBy(workOrderOutbox.createdAt)
      .limit(BATCH);
    let delivered = 0;
    for (const row of rows) {
      if (await attempt(row)) delivered += 1;
    }
    return { delivered, failed: rows.length - delivered };
  }

  return {
    enqueue: async (organizationId: string, workOrderId: string | null, event: WorkOrderEvent) => {
      const settings = await integrations.settings(organizationId);
      const viaN8n = !!settings?.n8nWebhookUrl;
      const emails = viaN8n && event.type === "work_order.created" ? [] : composeEmails(event);
      const rows = [
        ...(viaN8n
          ? [{ channel: "n8n" as const, payload: JSON.stringify({ ...event, emails }) }]
          : []),
        ...(!viaN8n && sendEmail
          ? emails.map((email) => ({ channel: "email" as const, payload: JSON.stringify(email) }))
          : []),
      ].map((row) => ({
        id: crypto.randomUUID(),
        organizationId,
        workOrderId,
        eventType: event.type,
        nextAttemptAt: now(),
        createdAt: now(),
        ...row,
      }));
      if (rows.length === 0) return [];
      await db.insert(workOrderOutbox).values(rows);
      const ids = rows.map((r) => r.id);
      if (deps.immediate) {
        void deliver({ ids }).catch((error: unknown) =>
          console.warn("[API] work order delivery failed:", error),
        );
      }
      return ids;
    },
    deliver,
  };
}

export type WorkOrderOutbox = ReturnType<typeof createWorkOrderOutbox>;
