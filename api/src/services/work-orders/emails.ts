import { type EmailContent, escapeHtml, renderEmail } from "./email-layout";
import type { WorkOrderEvent } from "./events";

export type WorkOrderEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
};

type Role = "contractor" | "representative";

type Draft = Omit<EmailContent, "greeting">;

const COUNTING_RULES = [
  "Work on GitHub issues assigned to the builder in the work order's repositories counts.",
  'Pull requests should close their issue ("Closes #12") and be approved or merged by the repository owner.',
  "At the end of the period, the report and compensation request are drafted automatically.",
];

export function composeEmails(e: WorkOrderEvent): WorkOrderEmail[] {
  const out: WorkOrderEmail[] = [];
  const wo = e.workOrder;
  const r = e.request;
  const agency = e.agency.name || "Your agency";
  const builder = e.contractor.name;
  const period = wo.periodStart && wo.periodEnd ? `${wo.periodStart} → ${wo.periodEnd}` : "";
  const fromName = `${agency} via MultiAgency`;

  const summary = (...extra: [string, string][]): [string, string][] => {
    const rows: [string, string][] = [
      ["Work order", `${wo.id} · ${wo.title}`],
      ["Project", wo.project],
      ["Period", period],
      ...extra,
    ];
    return rows.filter(([, value]) => value);
  };

  const pageOf = (role: Role) => (role === "contractor" ? e.links.contractor : e.links.review);
  const view = (role: Role, label = "Open the work order") => {
    const url = pageOf(role);
    return url ? { label, url } : null;
  };

  const send = (role: Role, subject: string, draft: Draft) => {
    const person = role === "contractor" ? e.contractor : e.representative;
    if (!person.email) return;
    const first = person.name.split(" ")[0] || person.name;
    const { html, text } = renderEmail({ ...draft, greeting: `Hi ${first},` }, agency);
    out.push({ to: person.email, subject, text, html, fromName });
  };

  switch (e.type) {
    case "work_order.offered":
      send("contractor", `${agency} sent you Work Order ${wo.id} to sign`, {
        preheader: `${wo.title}: review the terms and sign to accept.`,
        eyebrow: "Work order sent",
        heading: `${agency} sent you a work order`,
        paragraphs: [
          `You're offered "${wo.title}" on ${wo.project}. Review the terms and sign to accept. It only takes a minute.`,
          `Each approved payout request is paid to ${e.contractor.nearAccount}.`,
        ],
        details: summary(["Budget", `up to ${wo.budget}`], ["Paid to", e.contractor.nearAccount]),
        action: e.links.sign
          ? { label: "Review and sign", url: e.links.sign }
          : view("contractor", "Review and sign"),
        secondary:
          e.links.sign && e.links.contractor
            ? [{ label: "View it on MultiAgency", url: e.links.contractor }]
            : [],
        footnote: "Not for you? You can decline it from the signing page.",
      });
      break;
    case "work_order.builder_signed":
      send("representative", `Your turn to sign Work Order ${wo.id}`, {
        preheader: `${builder} signed. Countersign to complete it.`,
        eyebrow: "Countersignature needed",
        heading: `${builder} signed Work Order ${wo.id}`,
        paragraphs: [
          `${builder} signed "${wo.title}". Countersign it for ${agency} to complete the work order.`,
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: e.links.countersign
          ? { label: "Countersign", url: e.links.countersign }
          : view("representative", "Countersign"),
        secondary:
          e.links.countersign && e.links.review
            ? [{ label: "View it on MultiAgency", url: e.links.review }]
            : [],
      });
      break;
    case "work_order.signed":
      send("representative", `Work Order ${wo.id} is signed`, {
        preheader: `${builder} and ${agency} have both signed.`,
        eyebrow: "Work order signed",
        heading: `Work Order ${wo.id} is signed`,
        paragraphs: [
          `${builder} and ${agency} have both signed. The signed PDF is attached to the work order.`,
          "It becomes active automatically when its period starts.",
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative"),
        secondary: e.links.document
          ? [{ label: "Download the signed PDF", url: e.links.document }]
          : [],
      });
      break;
    case "work_order.active":
      send("contractor", `Work Order ${wo.id} is active`, {
        preheader: `Your work period has started: ${period}.`,
        eyebrow: "Work order active",
        heading: `Work Order ${wo.id} is active`,
        paragraphs: ["Your work period has started. Here's how your work is counted:"],
        list: { title: null, items: COUNTING_RULES },
        details: summary(["Budget", wo.budget], ["Paid to", e.contractor.nearAccount]),
        action: view("contractor"),
      });
      break;
    case "work_order.renewed": {
      const next = e.renewal?.renewedTo;
      send("representative", `Work Order ${wo.id} is renewed`, {
        preheader: next
          ? `${builder}'s work order continues as ${next.id}.`
          : "It continues next month.",
        eyebrow: "Work order renewed",
        heading: `Work Order ${wo.id} is renewed`,
        paragraphs: [
          next
            ? `${builder}'s work order continues next month as ${next.id}, ${next.periodStart} → ${next.periodEnd}, with the same terms.`
            : `${builder}'s work order continues next month with the same terms.`,
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative"),
      });
      break;
    }
    case "request.awaiting_approval":
      send("contractor", `Your payout request for ${wo.id} was sent`, {
        preheader: `${r?.requested ?? "Your request"} is waiting for ${agency}'s approval.`,
        eyebrow: "Work order summary",
        heading: "Your payout request was sent",
        paragraphs: [
          `${agency} has your payout request ${r?.id ?? ""} for ${r?.requested ?? ""}. You'll get an email when it's paid.`,
        ],
        details: summary(
          ["Request", r?.id ?? ""],
          ["Requested", r?.requested ?? ""],
          ["Budget", wo.budget],
          ["Paid to", e.contractor.nearAccount],
        ),
        action: view("contractor"),
        block: e.reportMd ? { title: "Your report", body: e.reportMd } : null,
      });
      send("representative", `Payout requested: ${r?.requested ?? ""} for ${builder}`, {
        preheader: `${builder} requested ${r?.requested ?? "a payout"} for ${wo.id}.`,
        eyebrow: "Payout requested",
        heading: `${builder} requested ${r?.requested ?? "a payout"}`,
        paragraphs: [
          `${builder}${e.contractor.github ? ` (@${e.contractor.github})` : ""} sent payout request ${r?.id ?? ""}.`,
          `Review the report and approve an amount. It's then paid to ${e.contractor.nearAccount}.`,
        ],
        details: summary(["Request", r?.id ?? ""], ["Requested", r?.requested ?? ""]),
        action: view("representative", "Review and approve"),
        block: e.reportMd ? { title: "Report", body: e.reportMd } : null,
      });
      break;
    case "request.approved": {
      const amount = r?.approved ?? r?.requested ?? "";
      send("contractor", `Payout approved: ${amount} for ${wo.id}`, {
        preheader: `${agency} approved ${amount} for request ${r?.id ?? wo.id}.`,
        eyebrow: "Payout approved",
        heading: `${agency} approved${amount ? ` ${amount}` : " your request"}`,
        paragraphs: [
          `Your payout request ${r?.id ?? ""} was approved. You'll get another email when it's paid to ${e.contractor.nearAccount}.`,
        ],
        details: summary(
          ["Request", r?.id ?? ""],
          ["Approved", amount],
          ["Paid to", e.contractor.nearAccount],
        ),
        action: view("contractor"),
      });
      break;
    }
    case "request.payout_released": {
      const amount = r?.approved ?? r?.requested ?? "";
      send("contractor", `Payout sent: ${amount} for ${wo.id}`, {
        preheader: `Your payout for ${r?.id ?? wo.id} was sent to ${e.contractor.nearAccount}.`,
        eyebrow: "Payout sent",
        heading: `You've been paid${amount ? ` ${amount}` : ""}`,
        paragraphs: [
          `Your payout for request ${r?.id ?? ""} was sent to ${e.payout?.near ?? e.contractor.nearAccount}.`,
        ],
        details: summary(
          ["Request", r?.id ?? ""],
          ["Amount", amount],
          ["Paid to", e.payout?.near ?? e.contractor.nearAccount],
        ),
        action: e.payout?.txUrl
          ? { label: "View the transaction", url: e.payout.txUrl }
          : view("contractor"),
        secondary:
          e.payout?.txUrl && e.links.contractor
            ? [{ label: "Open the work order", url: e.links.contractor }]
            : [],
      });
      break;
    }
    case "request.needs_review":
      if (r?.status !== "rejected") break;
      send("contractor", `Payout declined: request ${r.id}`, {
        preheader: `${agency} declined payout request ${r.id}.`,
        eyebrow: "Payout declined",
        heading: `Payout request ${r.id} was declined`,
        paragraphs: [
          `${agency} declined your payout request for ${r.requested}.`,
          ...(r.note ? [`Their note: "${r.note}"`] : []),
          "You can update your report and send a new request from the work order page.",
        ],
        details: summary(["Request", r.id], ["Requested", r.requested]),
        action: view("contractor"),
      });
      break;
    default:
      break;
  }
  return out;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

export function emailHtml(text: string): string {
  const body = escapeHtml(text).replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`);
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${body}</div>`;
}
