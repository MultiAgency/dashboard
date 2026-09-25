import { Badge } from "@/components/ui/badge";
import type { ApiClient } from "@/lib/api";

export type IdeaView = Awaited<ReturnType<ApiClient["ideas"]["list"]>>["data"][number];

const IDEA_STATUS: Record<
  IdeaView["status"],
  { label: string; variant: "default" | "outline" | "secondary" }
> = {
  new: { label: "New", variant: "default" },
  accepted: { label: "Accepted", variant: "outline" },
  declined: { label: "Declined", variant: "secondary" },
};

export function IdeaStatusBadge({ status }: { status: IdeaView["status"] }) {
  const { label, variant } = IDEA_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}
