import { BellIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { useApiClient } from "@/lib/api";
import { unreadNotificationsQueryOptions } from "@/lib/queries";

export function NotificationsBell() {
  const apiClient = useApiClient();
  const count = useQuery(unreadNotificationsQueryOptions(apiClient)).data?.count ?? 0;
  const label =
    count === 0 ? "notifications" : `${count} unread notification${count === 1 ? "" : "s"}`;

  return (
    <Link
      to="/notifications"
      aria-label={label}
      title={label}
      className="flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BellIcon className="size-4" />
      {count > 0 && (
        <Badge variant="default" className="px-1.5 py-0 font-mono text-[10px]">
          {count > 99 ? "99+" : count}
        </Badge>
      )}
    </Link>
  );
}
