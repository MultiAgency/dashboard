import { ArrowRightIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { awaitingLink } from "@/lib/change-orders";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  awaitingChangeOrdersQueryOptions,
  invalidateWorkspaceQueries,
  notificationsQueryKey,
  refreshAfter,
  setActiveOrganizationKey,
} from "@/lib/queries";
import { switchWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_layout/_authenticated/notifications")({
  head: () => ({
    meta: [{ title: "Notifications" }, { name: "description", content: "Your inbox." }],
  }),
  component: NotificationsPage,
});

type Notification = {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function NotificationsPage() {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const activeOrganizationId = session?.session?.activeOrganizationId ?? null;

  const inbox = useInfiniteQuery({
    queryKey: [...notificationsQueryKey, "list"],
    queryFn: ({ pageParam }) => apiClient.notifications.list({ cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items: Notification[] = inbox.data?.pages.flatMap((p) => p.data) ?? [];
  const awaiting = (useQuery(awaitingChangeOrdersQueryOptions(apiClient)).data?.data ?? []).filter(
    (changeOrder) => changeOrder.canDecide,
  );
  const unread = items.filter((n) => !n.readAt);

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => apiClient.notifications.markRead({ ids }),
    onSuccess: () => refreshAfter(queryClient, { type: "notifications" }),
  });

  const open = useMutation({
    mutationFn: async (notification: Notification) => {
      if (!notification.readAt) await apiClient.notifications.markRead({ ids: [notification.id] });
      if (notification.organizationId !== activeOrganizationId) {
        const switched = await switchWorkspace(authClient, notification.organizationId);
        if (!switched) throw new Error("You are no longer a member of that Organization.");
        setActiveOrganizationKey(notification.organizationId);
        await invalidateWorkspaceQueries(queryClient, router);
      }
      return notification.link;
    },
    onSuccess: async (link) => {
      await refreshAfter(queryClient, { type: "notifications" });
      if (link) router.history.push(link);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            you · inbox
          </div>
          <h1 className="text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
            Notifications
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unread.length === 0 || markRead.isPending}
          onClick={() => markRead.mutate(undefined)}
        >
          mark all read
        </Button>
      </header>

      {awaiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Change orders awaiting you
          </h2>
          {awaiting.map((changeOrder) => (
            <Card key={changeOrder.id}>
              <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">to decide</Badge>
                    <span className="text-sm font-medium">
                      Change order from the {changeOrder.proposedBy.side}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {changeOrder.note ??
                      changeOrder.items
                        .filter((item) => item.projectId !== null)
                        .map((item) => formatTokenAmount(item.amount, item.tokenId))
                        .join(", ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.history.push(awaitingLink(changeOrder))}
                >
                  review
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {inbox.isError && <AdminError error={inbox.error} />}
      {inbox.isSuccess && items.length === 0 && (
        <Empty label="Nothing yet. Engagement proposals and shared Projects show up here." />
      )}

      <div className="space-y-2">
        {items.map((notification) => (
          <Card key={notification.id} className={notification.readAt ? "opacity-70" : undefined}>
            <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {!notification.readAt && <Badge variant="default">new</Badge>}
                  <span className="text-sm font-medium">{notification.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{notification.body}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                </p>
              </div>
              {notification.link && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={open.isPending}
                  onClick={() => open.mutate(notification)}
                >
                  open
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {inbox.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => inbox.fetchNextPage()}
            disabled={inbox.isFetchingNextPage}
          >
            {inbox.isFetchingNextPage ? "loading..." : "load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
