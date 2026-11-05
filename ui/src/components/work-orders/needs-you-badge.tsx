import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useApiClient } from "@/lib/api";
import { formatCount } from "@/lib/format-count";
import { adminWorkOrdersNeedsYouQueryOptions } from "@/lib/queries";

export function WorkOrdersNeedsYouBadge() {
  const apiClient = useApiClient();
  const { data } = useQuery(adminWorkOrdersNeedsYouQueryOptions(apiClient));
  const count = data?.count ?? 0;
  if (count === 0) return null;
  return (
    <Badge
      size="counter"
      className="ml-auto"
      aria-label={`${count} ${count === 1 ? "needs" : "need"} you`}
    >
      {formatCount(count)}
    </Badge>
  );
}
