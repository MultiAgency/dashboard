import { createHmac } from "node:crypto";
import type { RenewalAssessment } from "./types";

export const WORK_ORDER_EVENT_TYPES = [
  "work_order.created",
  "work_order.document_ready",
  "work_order.signature_mismatch",
  "work_order.offered",
  "work_order.signed",
  "work_order.confirm_payee",
  "work_order.payee_confirmed",
  "work_order.active",
  "work_order.declined",
  "work_order.ending_soon",
  "work_order.renewed",
  "work_order.renewal_needs_approval",
  "work_order.not_renewed",
  "request.report_ready",
  "request.awaiting_approval",
  "request.approved",
  "request.payout_released",
  "request.needs_review",
  "integration.test",
] as const;

export type WorkOrderEventType = (typeof WORK_ORDER_EVENT_TYPES)[number];

export type WorkOrderEventTerms = {
  effectiveDate: string;
  servicesAgreementDate: string | null;
  budgetUsd: string;
  budget: string;
  symbol: string;
  ipModel: string | null;
  payee: string;
  payoutMethod: "withdraw" | "transfer";
  contractorGithub: string;
  repos: string[];
  autoRenew: boolean;
  scope: string | null;
};

export type WorkOrderEvent = {
  id: string;
  type: WorkOrderEventType;
  createdAt: string;
  agency: { id: string; name: string };
  workOrder: {
    id: string;
    title: string;
    project: string;
    periodStart: string;
    periodEnd: string;
    budget: string;
  };
  contractor: { name: string; email: string | null; github: string; nearAccount: string };
  representative: { name: string; email: string | null };
  request: null | {
    id: string;
    status: string;
    requestedUsd: string;
    approvedUsd: string | null;
    tokenAmount: string | null;
    symbol: string;
    requested: string;
    approved: string | null;
    note: string | null;
  };
  payout: null | { txUrl: string | null; near: string };
  links: {
    contractor: string | null;
    review: string | null;
    report: string | null;
    confirm: string | null;
    document: string | null;
  };
  reportMd: string | null;
  terms: WorkOrderEventTerms | null;
  mismatches: string[] | null;
  note: string | null;
  emails?: { to: string; subject: string; text: string }[];
  renewal: null | {
    assessment: RenewalAssessment;
    renewedTo: { id: string; periodStart: string; periodEnd: string } | null;
  };
};

export function signEvent(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

export function eventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

export function testEvent(organizationId: string): WorkOrderEvent {
  return {
    id: eventId(),
    type: "integration.test",
    createdAt: new Date().toISOString(),
    agency: { id: organizationId, name: "" },
    workOrder: {
      id: "TEST",
      title: "Connection test",
      project: "",
      periodStart: "",
      periodEnd: "",
      budget: "",
    },
    contractor: { name: "", email: null, github: "", nearAccount: "" },
    representative: { name: "", email: null },
    request: null,
    payout: null,
    links: { contractor: null, review: null, report: null, confirm: null, document: null },
    reportMd: null,
    terms: null,
    mismatches: null,
    note: null,
    renewal: null,
  };
}
