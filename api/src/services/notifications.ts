import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { notifications } from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import { appUrl, type EmailSender, escapeHtml } from "./notify";

type Payload = Record<string, string>;

type Template = (payload: Payload) => { title: string; body: string };

export const NOTIFICATION_KINDS = {
  engagement_proposed: (p) => ({
    title: `${p.agencyName} proposed an Engagement`,
    body: `${p.agencyName} wants to work with ${p.clientName} as its Agency. Accept or decline it on MultiAgency.`,
  }),
  engagement_accepted: (p) => ({
    title: `${p.clientName} accepted your Engagement`,
    body: `${p.clientName} accepted the Engagement with ${p.agencyName}. You can now share Projects with them.`,
  }),
  engagement_declined: (p) => ({
    title: `${p.clientName} declined your Engagement`,
    body: `${p.clientName} declined the Engagement proposed by ${p.agencyName}.`,
  }),
  engagement_ended: (p) => ({
    title: `The Engagement between ${p.agencyName} and ${p.clientName} ended`,
    body: `${p.endedBy} ended the Engagement. Its shared Projects stay visible as read-only history.`,
  }),
  subcontract_started: (p) => ({
    title: `${p.agencyName} subcontracted work to ${p.clientName}`,
    body: `${p.agencyName} hired ${p.clientName} as its Subcontractor on ${p.projectTitles}. Assign your builders and bill them from your Agency DAO on MultiAgency.`,
  }),
  project_shared: (p) => ({
    title: `${p.agencyName} shared ${p.projectTitle}`,
    body: `${p.agencyName} shared the Project ${p.projectTitle} with ${p.clientName}.`,
  }),
  project_unshared: (p) => ({
    title: `${p.agencyName} stopped sharing ${p.projectTitle}`,
    body: `${p.agencyName} no longer shares the Project ${p.projectTitle} with ${p.clientName}.`,
  }),
  client_invite_sent: (p) => ({
    title: `Invitation sent to ${p.email}`,
    body: `${p.email} was invited as the first admin of ${p.clientName}.`,
  }),
  client_invite_accepted: (p) => ({
    title: `${p.clientName} joined`,
    body: `${p.email} accepted the invitation and now manages ${p.clientName}.`,
  }),
  prepayment_recorded: (p) => ({
    title: `${p.agencyName} recorded a Prepayment`,
    body: `${p.agencyName} recorded a Prepayment of ${p.amount} for ${p.period}. Your Prepaid balance is updated on MultiAgency.`,
  }),
  prepayment_corrected: (p) => ({
    title: `${p.agencyName} corrected a Prepayment`,
    body: `${p.agencyName} corrected a Prepayment. It is now ${p.amount} for ${p.period}.`,
  }),
  prepayment_removed: (p) => ({
    title: `${p.agencyName} removed a Prepayment`,
    body: `${p.agencyName} removed the Prepayment of ${p.amount} for ${p.period}.`,
  }),
  change_order_proposed: (p) => ({
    title: `${p.proposerName} proposed a Change order`,
    body: `${p.proposerName} proposed a Change order on the Engagement between ${p.agencyName} and ${p.clientName}. Approve or reject it on MultiAgency.`,
  }),
  change_order_withdrawn: (p) => ({
    title: `${p.proposerName} withdrew a Change order`,
    body: `${p.proposerName} withdrew a Change order on the Engagement between ${p.agencyName} and ${p.clientName}. Nothing changes.`,
  }),
  change_order_approved: (p) => ({
    title: `${p.deciderName} approved your Change order`,
    body: `${p.deciderName} approved your Change order on the Engagement between ${p.agencyName} and ${p.clientName}.`,
  }),
  change_order_rejected: (p) => ({
    title: `${p.deciderName} rejected your Change order`,
    body: `${p.deciderName} rejected your Change order on the Engagement between ${p.agencyName} and ${p.clientName}. Nothing changes.`,
  }),
  change_order_failed: (p) => ({
    title: "A Change order could not be applied",
    body: `A Change order on the Engagement between ${p.agencyName} and ${p.clientName} could not be applied because the limits no longer allowed it. Nothing changed; propose a new one if still needed.`,
  }),
  plan_shortfall: (p) => ({
    title: `The Allocation plan for ${p.period} was not fully applied`,
    body: `The Prepaid balance of ${p.clientName} with ${p.agencyName} did not cover ${p.count} plan line(s) for ${p.period} (${p.amounts}). They were skipped.`,
  }),
} satisfies Record<string, Template>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

function isKind(kind: string): kind is NotificationKind {
  return kind in NOTIFICATION_KINDS;
}

function render(kind: string, payload: Payload) {
  return isKind(kind) ? NOTIFICATION_KINDS[kind](payload) : { title: kind, body: "" };
}

function parsePayload(raw: string): Payload {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Payload) : {};
  } catch {
    return {};
  }
}

export type NotifyInput = {
  organizationId: string;
  kind: NotificationKind;
  payload: Payload;
  link: string;
  excludeUserId?: string | null;
};

export function createNotifications(deps: {
  db: Database;
  directory: OrganizationDirectory;
  sendEmail: EmailSender | null;
  appOrigin: string;
}) {
  const { db, directory, sendEmail, appOrigin } = deps;

  async function deliverEmails(
    to: string[],
    content: { title: string; body: string },
    url: string | null,
  ) {
    if (!sendEmail || to.length === 0) return 0;
    const html = `<p>${escapeHtml(content.body)}</p>${
      url ? `<p><a href="${escapeHtml(url)}">Open in MultiAgency</a></p>` : ""
    }`;
    const results = await Promise.allSettled(
      to.map((address) => sendEmail({ to: address, subject: content.title, html })),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        const reason = r.reason as Error | undefined;
        console.warn("[API] notification email failed:", reason?.message ?? reason);
      }
    }
    return results.filter((r) => r.status === "fulfilled").length;
  }

  return {
    notify: async (input: NotifyInput) => {
      const recipients = (await directory.managers(input.organizationId)).filter(
        (r) => r.userId !== input.excludeUserId,
      );
      if (recipients.length === 0) return { recipients: 0, emailed: 0 };
      const payload = JSON.stringify(input.payload);
      await db.insert(notifications).values(
        recipients.map((r) => ({
          id: crypto.randomUUID(),
          recipientUserId: r.userId,
          organizationId: input.organizationId,
          kind: input.kind,
          payload,
          link: input.link,
        })),
      );
      const emails = [
        ...new Set(recipients.flatMap((r) => (r.email ? [r.email.toLowerCase()] : []))),
      ];
      const url = appUrl(appOrigin, input.link);
      const emailed = await deliverEmails(emails, render(input.kind, input.payload), url);
      return { recipients: recipients.length, emailed };
    },

    list: async (userId: string, input: { cursor?: string; limit: number }) => {
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            cursorWhere(notifications.createdAt, notifications.id, input.cursor),
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(input.limit);
      const last = rows[rows.length - 1];
      return {
        data: rows.map((row) => {
          const payload = parsePayload(row.payload);
          const { title, body } = render(row.kind, payload);
          return {
            id: row.id,
            organizationId: row.organizationId,
            kind: row.kind,
            title,
            body,
            link: row.link,
            readAt: row.readAt,
            createdAt: row.createdAt,
          };
        }),
        nextCursor: rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
      };
    },

    unreadCount: async (userId: string) => {
      const [row] = await db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
      return { count: Number(row?.n ?? 0) };
    },

    markRead: async (userId: string, input: { ids?: string[] }) => {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            isNull(notifications.readAt),
            input.ids ? inArray(notifications.id, input.ids) : undefined,
          ),
        );
      return { ok: true as const };
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotifications>;
