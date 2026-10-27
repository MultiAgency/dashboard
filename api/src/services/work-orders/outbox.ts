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
import { EMAIL_LOGO } from "./email-logo";
import { composeEmails, emailHtml, type WorkOrderEmail } from "./emails";
import type { WorkOrderEvent } from "./events";

const FIRST_RETRY_MS = 60_000;
const MAX_RETRY_MS = 3_600_000;
const GIVE_UP_MS = 24 * 3_600_000;
const BATCH = 50;
const CLAIM_MS = 5 * 60_000;

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

  async function ensure(organizationId: string, actorId: string) {
    await db
      .insert(workOrderIntegrations)
      .values({ organizationId, updatedBy: actorId, updatedAt: now() })
      .onConflictDoNothing({ target: workOrderIntegrations.organizationId });
  }

  return {
    settings,

    saveTrust: async (
      organizationId: string,
      actorId: string,
      input: { mode: "off" | "suggest" | "auto"; vetoHours: number },
    ) => {
      await ensure(organizationId, actorId);
      await db
        .update(workOrderIntegrations)
        .set({
          trustMode: input.mode,
          trustVetoHours: input.vetoHours,
          updatedBy: actorId,
          updatedAt: now(),
        })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
    },

    representative: async (organizationId: string) => {
      const row = await settings(organizationId);
      return {
        name: row?.defaultRepresentativeName ?? null,
        email: row?.defaultRepresentativeEmail ?? null,
      };
    },

    saveRepresentative: async (
      organizationId: string,
      actorId: string,
      input: { name: string | null; email: string | null },
    ) => {
      await ensure(organizationId, actorId);
      await db
        .update(workOrderIntegrations)
        .set({
          defaultRepresentativeName: input.name?.trim() || null,
          defaultRepresentativeEmail: input.email?.trim().toLowerCase() || null,
          updatedBy: actorId,
          updatedAt: now(),
        })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
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
      await ensure(organizationId, actorId);
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
  sendEmail: EmailSender | null;
  immediate?: boolean;
  now?: () => Date;
}) {
  const { db, sendEmail } = deps;
  const now = () => deps.now?.() ?? new Date();

  async function claim(row: WorkOrderOutboxRow): Promise<boolean> {
    const claimed = await db
      .update(workOrderOutbox)
      .set({ nextAttemptAt: new Date(now().getTime() + CLAIM_MS) })
      .where(
        and(
          eq(workOrderOutbox.id, row.id),
          isNull(workOrderOutbox.deliveredAt),
          lte(workOrderOutbox.nextAttemptAt, now()),
        ),
      )
      .returning({ id: workOrderOutbox.id });
    return claimed.length > 0;
  }

  async function attempt(row: WorkOrderOutboxRow): Promise<boolean> {
    const attempts = row.attempts + 1;
    const retry = async (error: string) => {
      const delay = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);
      await db
        .update(workOrderOutbox)
        .set({ attempts, lastError: error, nextAttemptAt: new Date(now().getTime() + delay) })
        .where(eq(workOrderOutbox.id, row.id));
      console.warn(`[API] work order email ${row.eventType} not delivered: ${error}`);
      return false;
    };
    try {
      if (!sendEmail) return retry("email is not configured (RESEND_API_KEY, NOTIFY_FROM_EMAIL)");
      const email = JSON.parse(row.payload) as WorkOrderEmail;
      const html = email.html ?? emailHtml(email.text);
      await sendEmail({
        to: email.to,
        subject: email.subject,
        html,
        text: email.text,
        fromName: email.fromName,
        ...(html.includes(`cid:${EMAIL_LOGO.contentId}`) ? { inlineImages: [EMAIL_LOGO] } : {}),
      });
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
    let failed = 0;
    for (const row of rows) {
      if (!(await claim(row))) continue;
      if (await attempt(row)) delivered += 1;
      else failed += 1;
    }
    return { delivered, failed };
  }

  return {
    enqueue: async (organizationId: string, workOrderId: string | null, event: WorkOrderEvent) => {
      if (!sendEmail) return [];
      const rows = composeEmails(event).map((email) => ({
        id: crypto.randomUUID(),
        organizationId,
        workOrderId,
        eventType: event.type,
        payload: JSON.stringify(email),
        nextAttemptAt: now(),
        createdAt: now(),
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
