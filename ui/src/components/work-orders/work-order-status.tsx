import { Badge } from "@/components/ui/badge";
import type { ApiClient } from "@/lib/api";

export type WorkOrder = Awaited<ReturnType<ApiClient["workOrders"]["list"]>>["data"][number];
export type WorkOrderDetail = Awaited<ReturnType<ApiClient["workOrders"]["get"]>>;
export type CompensationRequest = WorkOrderDetail["requests"][number];
export type Evidence = WorkOrderDetail["evidence"][number];
export type Renewal = NonNullable<WorkOrder["renewal"]>;

type BadgeVariant = "default" | "outline" | "secondary" | "destructive";

const WORK_ORDER_STATUS: Record<WorkOrder["status"], { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  offered: { label: "Offered", variant: "default" },
  accepted: { label: "Accepted", variant: "default" },
  active: { label: "Active", variant: "outline" },
  ended: { label: "Ended", variant: "secondary" },
  exhausted: { label: "Budget used", variant: "secondary" },
  terminated: { label: "Terminated", variant: "destructive" },
};

const REQUEST_STATUS: Record<
  CompensationRequest["status"],
  { label: string; variant: BadgeVariant }
> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Waiting for approval", variant: "default" },
  approved: { label: "Approved, ready to pay", variant: "default" },
  paying: { label: "Paying", variant: "outline" },
  proposed: { label: "Proposal in the DAO", variant: "outline" },
  paid: { label: "Paid", variant: "outline" },
  rejected: { label: "Rejected", variant: "destructive" },
  failed: { label: "Payment failed", variant: "destructive" },
};

const RENEWAL_STATUS: Record<Renewal["status"], { label: string; variant: BadgeVariant }> = {
  renewed: { label: "Renewed", variant: "outline" },
  needs_approval: { label: "Manual Approval Needed", variant: "default" },
  declined: { label: "Not renewed", variant: "secondary" },
};

export function WorkOrderStatusBadge({ status }: { status: WorkOrder["status"] }) {
  const { label, variant } = WORK_ORDER_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RequestStatusBadge({ status }: { status: CompensationRequest["status"] }) {
  const { label, variant } = REQUEST_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function RenewalBadge({ status }: { status: Renewal["status"] }) {
  const { label, variant } = RENEWAL_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function formatPeriodShort(start: string, end: string): string {
  return `${start} → ${end}`;
}
