import { Badge } from "@/components/ui/badge";
import type { ApiClient } from "@/lib/api";

export type IdeaView = Awaited<ReturnType<ApiClient["ideas"]["list"]>>["data"][number];

const VARIANT = {
  new: "accent",
  accepted: "outline",
  declined: "secondary",
} as const;

export function IdeaStatusBadge({ status }: { status: IdeaView["status"] }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
