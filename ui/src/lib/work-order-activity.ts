import type { WorkOrderDetail } from "@/components/work-orders/work-order-status";
import type { ApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

export type WorkOrderEmail = Awaited<
  ReturnType<ApiClient["workOrders"]["activity"]>
>["emails"][number];

export type TimelineTone = "default" | "success" | "destructive" | "email";

export type TimelineEvent = {
  key: string;
  at: string;
  title: string;
  detail: string | null;
  tone: TimelineTone;
  href: string | null;
  hrefLabel: string | null;
};

function event(
  key: string,
  at: string | null | undefined,
  title: string,
  over: Partial<Omit<TimelineEvent, "key" | "at" | "title">> = {},
): TimelineEvent[] {
  if (!at) return [];
  return [{ key, at, title, detail: null, tone: "default", href: null, hrefLabel: null, ...over }];
}

function emailEvent(email: WorkOrderEmail): TimelineEvent {
  const subject = email.subject ?? email.eventType;
  const to = email.to ? ` → ${email.to}` : "";
  const status = email.deliveredAt
    ? "delivered"
    : email.lastError
      ? `failed: ${email.lastError}`
      : "sending";
  return {
    key: `email-${email.id}`,
    at: email.createdAt,
    title: `Email: ${subject}${to}`,
    detail: status,
    tone: email.deliveredAt ? "email" : email.lastError ? "destructive" : "email",
    href: null,
    hrefLabel: null,
  };
}

export function activityTimeline(
  wo: WorkOrderDetail,
  emails: WorkOrderEmail[] = [],
): TimelineEvent[] {
  const builder = wo.builder.name ?? wo.builder.nearAccount;
  const amount = (value: string | null) => (value ? formatTokenAmount(value, wo.tokenId) : null);
  const { signing, signature } = wo;
  const events: TimelineEvent[] = [
    ...event("created", wo.createdAt, "Created as a draft"),
    ...event("offered", wo.offeredAt, `Offered to ${builder}`),
    ...event(
      "representative-signed",
      signing.representative?.signedAt,
      `Signed by ${signing.representative?.name ?? "the representative"}`,
      { tone: "success" },
    ),
    ...event(
      "builder-signed",
      signing.builder?.signedAt,
      `Signed by ${signing.builder?.name ?? builder}`,
      { tone: "success" },
    ),
    ...(signing.builder
      ? []
      : event("accepted", wo.acceptedAt, `Accepted by ${builder}`, { tone: "success" })),
    ...event(
      "esigned",
      signature.method === "google_esign" ? signature.signedAt : null,
      "E-signed in Google Docs",
      {
        tone: "success",
        detail: signature.signers.map((s) => s.name).join(", ") || null,
        href: signature.driveUrl,
        hrefLabel: signature.driveUrl ? "Saved to Google Drive" : null,
      },
    ),
    ...(signature.method !== "google_esign" && signature.driveUrl
      ? event("drive", signature.signedAt ?? wo.acceptedAt, "Signed PDF saved", {
          href: signature.driveUrl,
          hrefLabel: "Open in Google Drive",
        })
      : []),
    ...event("activated", wo.activatedAt, "Activated: the work period started", {
      detail: `${wo.periodStart} → ${wo.periodEnd}`,
    }),
    ...wo.requests.flatMap((r) => [
      ...event(`${r.id}-submitted`, r.submittedAt, `${r.code} submitted`, {
        detail: `${amount(r.requestedAmount)} for ${r.coversFrom} → ${r.coversTo}`,
      }),
      ...event(
        `${r.id}-decided`,
        r.decidedAt,
        r.status === "rejected" ? `${r.code} rejected` : `${r.code} approved`,
        r.status === "rejected"
          ? { tone: "destructive", detail: r.note }
          : { tone: "success", detail: amount(r.approvedAmount) },
      ),
      ...event(`${r.id}-paid`, r.paidAt, `${r.code} paid`, {
        tone: "success",
        detail: amount(r.approvedAmount ?? r.requestedAmount),
      }),
      ...(r.status === "failed"
        ? event(`${r.id}-failed`, r.updatedAt, `${r.code} payment failed`, {
            tone: "destructive",
            detail: r.note,
          })
        : []),
    ]),
    ...event(
      "renewal",
      wo.renewal?.decidedAt,
      wo.renewal?.status === "renewed"
        ? "Renewed for the next period"
        : wo.renewal?.status === "declined"
          ? "Not renewed"
          : "Renewal decided",
      { detail: wo.renewal?.note ?? null },
    ),
    ...(wo.status === "terminated"
      ? event("terminated", wo.updatedAt, "Terminated", { tone: "destructive" })
      : []),
    ...emails.map(emailEvent),
  ];
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
