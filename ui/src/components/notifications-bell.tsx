import { BellIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApiClient } from "@/lib/api";
import { formatCount } from "@/lib/format-count";
import { unreadNotificationsQueryOptions } from "@/lib/queries";

export function NotificationsBell() {
  const apiClient = useApiClient();
  const count = useQuery(unreadNotificationsQueryOptions(apiClient)).data?.count ?? 0;
  const label =
    count === 0 ? "notifications" : `${count} unread notification${count === 1 ? "" : "s"}`;

  return (
    <Button asChild variant="ghost" size="icon-sm" className="relative">
      <Link to="/notifications" aria-label={label} title={label}>
        <BellIcon aria-hidden />
        {count > 0 && (
          <Badge size="counter" className="absolute -top-1 -right-1" aria-hidden>
            {formatCount(count)}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
