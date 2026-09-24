import { Badge } from "@/components/ui/badge";
import type { ApiClient } from "@/lib/api";

export type EngagementView = Awaited<ReturnType<ApiClient["engagements"]["get"]>>;

const VARIANT = {
  proposed: "accent",
  active: "outline",
  declined: "secondary",
  ended: "secondary",
} as const;

export function EngagementStatusBadge({ status }: { status: EngagementView["status"] }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}

export function InvitationStatusBadge({
  invitation,
}: {
  invitation: NonNullable<EngagementView["invitation"]>;
}) {
  return (
    <Badge variant={invitation.status === "pending" ? "accent" : "secondary"}>
      invite {invitation.status}
    </Badge>
  );
}
