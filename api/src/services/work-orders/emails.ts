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

const HOLD_FIXES: Record<
  string,
  { subject: string; heading: string; why: string; next: string; action: string }
> = {
  insufficient_balance: {
    subject: "fund the agent",
    heading: "Fund the agent",
    why: "it doesn't hold enough NEAR",
    next: "Top up the payout agent from the treasury.",
    action: "Fund the agent",
  },
  over_monthly_budget: {
    subject: "raise the monthly budget",
    heading: "Raise the monthly budget",
    why: "it would go over this month's payout budget",
    next: "Raise the monthly budget in the payout settings, or wait for it to reset.",
    action: "Open the payout settings",
  },
  over_cap: {
    subject: "raise the payout cap",
    heading: "Raise the payout cap",
    why: "it's more than the agent may send in one payout",
    next: "Raise the maximum per payout in the payout settings.",
    action: "Open the payout settings",
  },
};

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

  const starts = wo.periodStarted
    ? "it starts right away"
    : `its work period runs from ${wo.periodStart} to ${wo.periodEnd}`;

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
        preheader: e.links.sign
          ? `${agency} has signed ${wo.title}. Sign it to accept; ${starts}.`
          : `${wo.title}: review the terms and sign to accept.`,
        eyebrow: "Work order sent",
        heading: `${agency} sent you a work order`,
        paragraphs: [
          e.links.sign
            ? `You're offered "${wo.title}" on ${wo.project}, and ${agency} has already signed it. Review the terms and sign to accept. As soon as you sign, it's complete: ${starts}.`
            : `You're offered "${wo.title}" on ${wo.project}. Review the terms and sign to accept. It only takes a minute.`,
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
          "It starts on its own unless something still blocks it, such as a payout account to confirm. The work order shows anything that's left.",
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative"),
        secondary: e.links.document
          ? [{ label: "Download the signed PDF", url: e.links.document }]
          : [],
      });
      break;
    case "work_order.active": {
      const upcoming = !wo.periodStarted;
      send("contractor", `Work Order ${wo.id} is active`, {
        preheader: upcoming
          ? `Your work period starts on ${wo.periodStart}: ${period}.`
          : `Your work period has started: ${period}.`,
        eyebrow: "Work order active",
        heading: `Work Order ${wo.id} is active`,
        paragraphs: [
          upcoming
            ? `Your work period starts on ${wo.periodStart}. Here's how your work is counted:`
            : "Your work period has started. Here's how your work is counted:",
        ],
        list: { title: null, items: COUNTING_RULES },
        details: summary(["Budget", wo.budget], ["Paid to", e.contractor.nearAccount]),
        action: view("contractor"),
      });
      break;
    }
    case "work_order.sign_first":
      send("representative", `Sign Work Order ${wo.id} to send it to ${builder}`, {
        preheader: `${builder} gets their signing link as soon as you've signed.`,
        eyebrow: "Your signature needed",
        heading: `Sign Work Order ${wo.id} first`,
        paragraphs: [
          `"${wo.title}" for ${builder} is ready in Documenso. You sign first for ${agency}; ${builder} gets their signing link as soon as you have.`,
          "Until you sign, nothing has gone to the builder.",
        ],
        details: summary(["Builder", builder], ["Budget", `up to ${wo.budget}`]),
        action: e.links.countersign
          ? { label: "Review and sign", url: e.links.countersign }
          : view("representative", "Open the work order"),
        secondary:
          e.links.countersign && e.links.review
            ? [{ label: "View it on MultiAgency", url: e.links.review }]
            : [],
      });
      break;
    case "work_order.declined":
      send("representative", `${builder} declined Work Order ${wo.id}`, {
        preheader: `${wo.title} is back in draft.`,
        eyebrow: "Work order declined",
        heading: `${builder} declined Work Order ${wo.id}`,
        paragraphs: [
          `${builder} declined "${wo.title}". It's back in draft: edit it and send it again, or delete it.`,
          ...(e.note ? [`Their note: "${e.note}"`] : []),
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative"),
      });
      break;
    case "work_order.esign_cancelled":
      send("representative", `The signing request for Work Order ${wo.id} was cancelled`, {
        preheader: `${wo.title} is back in draft.`,
        eyebrow: "Signing cancelled",
        heading: `The signing request for Work Order ${wo.id} was cancelled`,
        paragraphs: [
          `The signing request for "${wo.title}" was cancelled, so it's back in draft. Send it again, or delete it.`,
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative"),
      });
      break;
    case "work_order.confirm_payee":
      send("contractor", `Confirm your payout account for Work Order ${wo.id}`, {
        preheader: `Confirm ${e.contractor.nearAccount} so you can be paid.`,
        eyebrow: "Payout account",
        heading: "Confirm your payout account",
        paragraphs: [
          `${agency} hasn't paid ${e.contractor.nearAccount} before. Open the work order signed in with that NEAR account and confirm it.`,
          "It's free, takes a few seconds and doesn't move any money.",
        ],
        details: summary(["Paid to", e.contractor.nearAccount]),
        action: e.links.confirm
          ? { label: "Confirm the account", url: e.links.confirm }
          : view("contractor", "Confirm the account"),
      });
      break;
    case "work_order.ending_soon":
      send("contractor", `Work Order ${wo.id} ends on ${wo.periodEnd}`, {
        preheader: `Your work period ends on ${wo.periodEnd}.`,
        eyebrow: "Ending soon",
        heading: `Your work period ends on ${wo.periodEnd}`,
        paragraphs: [
          "Your report and payout request are drafted right after it ends; you review them and send the request.",
          'Make sure your pull requests close their assigned issues ("Closes #12") so they count.',
        ],
        details: summary(["Budget", wo.budget]),
        action: view("contractor"),
      });
      break;
    case "work_order.renewal_needs_approval": {
      const metrics = e.renewal?.assessment.metrics ?? [];
      send("representative", `Renew ${builder}'s Work Order ${wo.id}? It needs your decision`, {
        preheader: `It missed a renewal target, so it wasn't renewed automatically.`,
        eyebrow: "Renewal needs a decision",
        heading: `Renew ${builder}'s work order?`,
        paragraphs: [
          `The period of "${wo.title}" is over and it missed at least one renewal target, so it wasn't renewed automatically. Renew it anyway or let it end.`,
        ],
        list: metrics.length
          ? {
              title: "Renewal targets",
              items: metrics.map(
                (m) => `${m.met ? "Met" : "Missed"}: ${m.label}: ${m.value} (needs ${m.target})`,
              ),
            }
          : undefined,
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: view("representative", "Decide on the renewal"),
      });
      break;
    }
    case "work_order.not_renewed":
      send("contractor", `Work Order ${wo.id} isn't renewed`, {
        preheader: `${wo.title} ends with this period.`,
        eyebrow: "Not renewed",
        heading: `Work Order ${wo.id} isn't renewed`,
        paragraphs: [
          `${agency} didn't renew "${wo.title}". It ends with this period.`,
          "Payout requests for work done in this period still go through as usual.",
        ],
        details: summary(["Budget", wo.budget]),
        action: view("contractor"),
      });
      break;
    case "work_order.terminated":
      send("contractor", `${agency} ended Work Order ${wo.id}`, {
        preheader: `${wo.title} is terminated.`,
        eyebrow: "Work order ended",
        heading: `${agency} ended Work Order ${wo.id}`,
        paragraphs: [
          `${agency} terminated "${wo.title}". You can't send new payout requests under it.`,
          `Payouts already sent aren't affected. Contact ${agency} if you have questions.`,
        ],
        details: summary(["Budget", wo.budget]),
        action: view("contractor"),
      });
      break;
    case "work_order.withdrawn":
      send("contractor", `${agency} withdrew Work Order ${wo.id}`, {
        preheader: `There's nothing to sign: ${wo.title} was withdrawn.`,
        eyebrow: "Work order withdrawn",
        heading: `${agency} withdrew Work Order ${wo.id}`,
        paragraphs: [
          `${agency} withdrew its offer of "${wo.title}", so there's nothing to sign. If you got a signing link for it, ignore it.`,
          `Contact ${agency} if you have questions.`,
        ],
        details: summary(["Budget", `up to ${wo.budget}`]),
      });
      break;
    case "work_order.renewed": {
      const unsent = e.renewal?.unsent ?? null;
      const signLink = unsent ? null : (e.links.countersign ?? null);
      const subject = unsent
        ? `The renewal ${wo.id} wasn't sent: it needs you`
        : signLink
          ? `Sign the renewal: Work Order ${wo.id}`
          : `Work Order ${wo.id} renews: ${builder} accepts it next`;
      const preheader = unsent
        ? `${builder}'s renewal is saved as a draft: it wasn't sent for signature.`
        : signLink
          ? `${builder}'s work order continues for ${period}. Sign it to send it to ${builder}.`
          : `${builder} has the renewal to accept. You countersign it after.`;
      send("representative", subject, {
        preheader,
        eyebrow: "Work order renewed",
        heading: `${builder}'s work order renews as ${wo.id}`,
        paragraphs: [
          `${builder}'s work order continues for ${period} with the same terms. A new work order with the new dates goes out for signature.`,
          unsent
            ? `It's saved as a draft because it couldn't be sent for signature: ${unsent}. Open it to fix this and send it.`
            : signLink
              ? `Sign it first; ${builder} gets their signing link as soon as you have. It becomes active once you've both signed, and the signed PDF is filed like any other work order.`
              : `${builder} has it to accept. Once they have, countersign it and it becomes active.`,
        ],
        details: summary(["Builder", builder], ["Budget", wo.budget]),
        action: signLink
          ? { label: "Review and sign", url: signLink }
          : view("representative", unsent ? "Open the renewal" : "Open the work order"),
        secondary:
          signLink && e.links.review
            ? [{ label: "Open it in MultiAgency", url: e.links.review }]
            : [],
      });
      break;
    }
    case "request.report_ready":
      send("contractor", `Your report for Work Order ${wo.id} is ready to send`, {
        preheader: `Review your report and send your payout request${r?.requested ? ` for ${r.requested}` : ""}.`,
        eyebrow: "Report ready",
        heading: "Your report is ready to review",
        paragraphs: [
          `Payout request ${r?.id ?? ""} was drafted from your GitHub activity. Review the report, add any work outside GitHub and send it to ${agency}.`,
          "You're only paid once you send it.",
        ],
        details: summary(["Request", r?.id ?? ""], ["Requested", r?.requested ?? ""]),
        action: view("contractor", "Review and send"),
        block: e.reportMd ? { title: "Draft report", body: e.reportMd } : null,
      });
      break;
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
          : e.payout?.accountUrl
            ? { label: "See it on NearBlocks", url: e.payout.accountUrl }
            : view("contractor"),
        secondary:
          (e.payout?.txUrl || e.payout?.accountUrl) && e.links.contractor
            ? [{ label: "Open the work order", url: e.links.contractor }]
            : [],
      });
      break;
    }
    case "request.payout_blocked": {
      const hold = e.hold;
      if (!hold) break;
      const amount = r?.approved ?? r?.requested ?? "";
      const fix = HOLD_FIXES[hold.code] ?? HOLD_FIXES.insufficient_balance!;
      const settings = e.links.settings ?? e.links.review;
      send("representative", `Payout on hold: ${fix.subject} to pay ${builder} ${amount}`.trim(), {
        preheader: `${r?.id ?? wo.id} for ${builder} is approved but can't be paid yet.`,
        eyebrow: "Payout on hold",
        heading: `${fix.heading} to pay ${builder}${amount ? ` ${amount}` : ""}`,
        paragraphs: [
          `Payout request ${r?.id ?? ""} is approved, but the payout agent can't send it yet: ${fix.why}.`,
          `${hold.reason.replace(/\.$/, "")}.`,
          `${fix.next} It's paid automatically once that's done: there's no need to approve it again.`,
        ],
        details: summary(
          ["Request", r?.id ?? ""],
          ["Amount", amount],
          ["Paid to", e.contractor.nearAccount],
          ["Agent holds", hold.balanceNear ? `${hold.balanceNear} NEAR` : ""],
          ["Needs", hold.neededNear ? `${hold.neededNear} NEAR` : ""],
        ),
        action: settings ? { label: fix.action, url: settings } : null,
        secondary:
          e.links.review && settings !== e.links.review
            ? [{ label: "Open the work order", url: e.links.review }]
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
