import type { WorkOrderEvent } from "./events";

export type WorkOrderEmail = { to: string; subject: string; text: string };

const lines = (...parts: (string | null | undefined | false)[]) =>
  parts.filter((part): part is string => typeof part === "string").join("\n");

export function composeEmails(e: WorkOrderEvent): WorkOrderEmail[] {
  const out: WorkOrderEmail[] = [];
  const wo = e.workOrder;
  const r = e.request;
  const agency = e.agency.name;
  const header = `Work Order ${wo.id}: ${wo.title} (${wo.project}), ${wo.periodStart} → ${wo.periodEnd}`;
  const toContractor = (subject: string, ...body: (string | null | undefined | false)[]) => {
    if (e.contractor.email) {
      out.push({
        to: e.contractor.email,
        subject,
        text: lines(`Hi ${e.contractor.name},`, "", ...body, "", `${agency} via MultiAgency`),
      });
    }
  };
  const toRepresentative = (subject: string, ...body: (string | null | undefined | false)[]) => {
    if (e.representative.email) {
      out.push({
        to: e.representative.email,
        subject,
        text: lines(`Hi ${e.representative.name},`, "", ...body, "", "MultiAgency"),
      });
    }
  };
  const toBoth = (subject: string, ...body: (string | null | undefined | false)[]) => {
    toContractor(subject, ...body);
    toRepresentative(subject, ...body);
  };

  switch (e.type) {
    case "work_order.created":
      toRepresentative(
        `Work Order ${wo.id} is drafted`,
        header,
        "",
        e.links.document
          ? `The document is ready: ${e.links.document}`
          : "If your Google Docs template is connected, the filled document arrives in a few minutes.",
        "Review it, then send it for signature in Google Docs: Tools → eSignature → Request signature (the builder and you).",
        "Once both have signed, save the signed PDF in your Signed folder on Drive. It is attached here automatically when its terms match.",
        e.links.review,
      );
      break;
    case "work_order.document_ready":
      toRepresentative(
        `Work Order ${wo.id} is ready to send for signature`,
        header,
        "",
        `The filled document: ${e.links.document}`,
        "Open it in Google Docs → Tools → eSignature → Request signature (the builder and you).",
        "When both have signed, save the signed PDF in your Signed folder on Drive. It is attached here automatically when its terms match.",
        e.links.review,
      );
      break;
    case "work_order.signature_mismatch":
      toRepresentative(
        `Work Order ${wo.id}: the signed PDF doesn't match the draft`,
        header,
        "",
        "A signed PDF arrived for this work order, but its terms differ from the draft, so it was NOT attached:",
        ...(e.mismatches ?? []).map((m) => `- ${m}`),
        "",
        "Fix the draft or the document and sign again.",
        e.links.review,
      );
      break;
    case "work_order.offered":
      toContractor(
        `${agency} offers you Work Order ${wo.id}`,
        header,
        "",
        `Budget: up to ${wo.budget}, paid per approved compensation request to ${e.contractor.nearAccount}.`,
        "Read the terms and accept or decline them, signed in with that NEAR account:",
        e.links.contractor,
      );
      break;
    case "work_order.signed":
      toBoth(
        `Work Order ${wo.id} is signed`,
        header,
        "",
        "The work order has been signed by both parties.",
        e.links.document ? `Signed document: ${e.links.document}` : null,
        "Next: the work order is activated by the Agency.",
      );
      break;
    case "work_order.confirm_payee":
      toContractor(
        `Confirm your payout account for Work Order ${wo.id}`,
        header,
        "",
        `Please confirm the account you will be paid to, ${e.contractor.nearAccount}, by signing in with that NEAR wallet and pressing Confirm.`,
        "It's free, takes a few seconds, and doesn't move any money:",
        e.links.confirm,
      );
      break;
    case "work_order.payee_confirmed":
      toRepresentative(
        `Work Order ${wo.id}: payout account confirmed`,
        header,
        "",
        `${e.contractor.name} proved they control ${e.contractor.nearAccount}. You can activate the work order.`,
        e.links.review,
      );
      break;
    case "work_order.active":
      toBoth(
        `Work Order ${wo.id} is active`,
        header,
        "",
        "The work order is now active.",
        'Work counts when it is on GitHub issues assigned to the builder in the work order repositories, and pull requests say "Closes #N" and are approved or merged by the repository owner.',
        "At the end of the period a compensation request with the report is drafted automatically.",
      );
      break;
    case "work_order.declined":
      toRepresentative(
        `Work Order ${wo.id} was declined`,
        header,
        "",
        "The builder declined the work order. Nothing can be paid under it until it is offered and accepted again.",
        e.note ? `Their note: ${e.note}` : null,
        e.links.review,
      );
      break;
    case "work_order.ending_soon":
      toContractor(
        `Work Order ${wo.id} ends on ${wo.periodEnd}`,
        header,
        "",
        `Your work period ends on ${wo.periodEnd}. Your compensation request and report will be drafted automatically right after.`,
        'Make sure your pull requests close their assigned issues ("Closes #12") so they are counted.',
      );
      break;
    case "work_order.renewed": {
      const next = e.renewal?.renewedTo;
      toBoth(
        `Work Order ${wo.id} is renewed`,
        header,
        "",
        next
          ? `The work order is renewed for next month as ${next.id}, ${next.periodStart} → ${next.periodEnd}, with the same terms.`
          : "The work order is renewed for next month.",
        "Work in the new period counts the same way. Its compensation request is drafted at the end of the period.",
      );
      break;
    }
    case "work_order.renewal_needs_approval":
      toRepresentative(
        `Manual Approval Needed: renewal of Work Order ${wo.id}`,
        header,
        "",
        "The period is over and it missed at least one base metric for renewal, so it was NOT renewed automatically:",
        ...(e.renewal?.assessment.metrics ?? []).map(
          (m) => `- ${m.met ? "met" : "MISSED"}: ${m.label}: ${m.value} (needed ${m.target})`,
        ),
        "",
        "Renew it anyway or let it end:",
        e.links.review,
      );
      break;
    case "work_order.not_renewed":
      toBoth(
        `Work Order ${wo.id} is not renewed`,
        header,
        "",
        "The work order was not renewed for next month. It ends with this period.",
        "Compensation requests for work done in this period still go through as usual.",
      );
      break;
    case "request.report_ready":
      toContractor(
        `Your report for Work Order ${wo.id} is ready to review`,
        header,
        "",
        `Compensation request ${r?.id ?? ""} has been drafted from your GitHub activity.`,
        "Please review it, edit the Assessment (it is a draft), add any work outside GitHub, and submit:",
        e.links.contractor,
        "",
        "--- Draft report ---",
        e.reportMd,
      );
      break;
    case "request.awaiting_approval":
      toRepresentative(
        `Approve: compensation request ${r?.id ?? ""} (${r?.requested ?? ""})`,
        header,
        "",
        `${e.contractor.name} (@${e.contractor.github}) submitted compensation request ${r?.id ?? ""} for ${r?.requested ?? ""}.`,
        "Review the report and approve an amount; it is paid through a transfer proposal of your Agency DAO:",
        e.links.review,
        "",
        "--- Report ---",
        e.reportMd,
      );
      break;
    case "request.approved":
      toContractor(
        `Compensation request ${r?.id ?? ""} is approved`,
        header,
        "",
        `${agency} approved ${r?.approved ?? ""}. It is paid to ${e.contractor.nearAccount} once the Agency DAO approves the transfer proposal.`,
        e.links.contractor,
      );
      break;
    case "request.payout_released":
      toContractor(
        `Payout released for Work Order ${wo.id}`,
        `Your payout for ${header} has been released.`,
        "",
        `Amount: ${r?.approved ?? r?.requested ?? "-"} → ${e.payout?.near ?? "-"}`,
        `Proposal: ${e.payout?.txUrl ?? "-"}`,
        `Request: ${r?.id ?? "-"}`,
        "",
        "--- Report ---",
        e.reportMd,
      );
      break;
    case "request.needs_review":
      toBoth(
        `Work Order ${wo.id}: request ${r?.id ?? ""} needs review`,
        header,
        "",
        `Compensation request ${r?.id ?? "-"} needs attention: ${r?.note ?? "see the work order"}.`,
        e.links.review,
      );
      break;
    case "integration.test":
      break;
  }
  return out;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailHtml(text: string): string {
  const body = escapeHtml(text).replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`);
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${body}</div>`;
}
