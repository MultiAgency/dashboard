import { Badge } from "@/components/ui/badge";
import type { ApiClient } from "@/lib/api";

export type EngagementView = Awaited<ReturnType<ApiClient["engagements"]["get"]>>;

type BadgeVariant = "default" | "outline" | "secondary" | "destructive";

type InvitationStatus = NonNullable<EngagementView["invitation"]>["status"];

const ENGAGEMENT_STATUS: Record<
  EngagementView["status"],
  { label: string; variant: BadgeVariant }
> = {
  proposed: { label: "Proposed", variant: "default" },
  active: { label: "Active", variant: "outline" },
  declined: { label: "Declined", variant: "secondary" },
  ended: { label: "Ended", variant: "secondary" },
};

const INVITATION_STATUS: Record<InvitationStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Invite pending", variant: "default" },
  accepted: { label: "Invite accepted", variant: "outline" },
  expired: { label: "Invite expired", variant: "destructive" },
  rejected: { label: "Invite declined", variant: "secondary" },
  canceled: { label: "Invite canceled", variant: "secondary" },
};

export function EngagementStatusBadge({ status }: { status: EngagementView["status"] }) {
  const { label, variant } = ENGAGEMENT_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function EngagementKindBadge({ kind }: { kind: EngagementView["kind"] }) {
  return kind === "subcontract" ? <Badge variant="secondary">Subcontract</Badge> : null;
}

export function InvitationStatusBadge({
  invitation,
}: {
  invitation: NonNullable<EngagementView["invitation"]>;
}) {
  const { label, variant } = INVITATION_STATUS[invitation.status];
  return <Badge variant={variant}>{label}</Badge>;
}
