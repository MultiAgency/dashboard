import type { RenewalAssessment } from "./types";

export const WORK_ORDER_EVENT_TYPES = [
  "work_order.created",
  "work_order.signature_mismatch",
  "work_order.offered",
  "work_order.builder_signed",
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
    sign?: string | null;
    countersign?: string | null;
  };
  reportMd: string | null;
  terms: WorkOrderEventTerms | null;
  mismatches: string[] | null;
  note: string | null;
  renewal: null | {
    assessment: RenewalAssessment;
    renewedTo: { id: string; periodStart: string; periodEnd: string } | null;
  };
};

export function eventId(): string {
  return `evt_${crypto.randomUUID()}`;
}
