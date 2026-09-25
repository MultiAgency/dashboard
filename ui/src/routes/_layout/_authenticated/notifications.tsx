import { ArrowRightIcon, BellIcon, ChecksIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  PageHeader,
  SectionHeader,
  Skeleton,
  Spinner,
} from "@/components";
import { AdminError } from "@/components/admin-error";
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
import { cn } from "@/lib/utils";
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
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader
        title="Notifications"
        description={
          inbox.isSuccess && unread.length > 0
            ? `${unread.length} unread${inbox.hasNextPage ? " on this page" : ""}.`
            : "Engagement proposals, shared Projects and billing updates."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={unread.length === 0 || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            <ChecksIcon data-icon="inline-start" aria-hidden />
            Mark all read
          </Button>
        }
      />

      {awaiting.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="awaiting-change-orders">
          <SectionHeader
            id="awaiting-change-orders"
            title="Change orders awaiting you"
            description="Approve or reject them from the Engagement's plan."
          />
          <ItemGroup>
            {awaiting.map((changeOrder) => (
              <li key={changeOrder.id}>
                <Item variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>To decide</Badge>
                      <ItemTitle>Change order from the {changeOrder.proposedBy.side}</ItemTitle>
                    </div>
                    <ItemDescription>
                      {changeOrder.note ??
                        changeOrder.items
                          .filter((item) => item.projectId !== null)
                          .map((item) => formatTokenAmount(item.amount, item.tokenId))
                          .join(", ")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.history.push(awaitingLink(changeOrder))}
                    >
                      Review
                      <ArrowRightIcon data-icon="inline-end" aria-hidden />
                    </Button>
                  </ItemActions>
                </Item>
              </li>
            ))}
          </ItemGroup>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="inbox">
        {awaiting.length > 0 && <SectionHeader id="inbox" title="Inbox" />}
        {inbox.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Loading notifications</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : inbox.isError ? (
          <AdminError error={inbox.error} />
        ) : items.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>You're all caught up</EmptyTitle>
              <EmptyDescription>
                Engagement proposals and shared Projects show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup aria-label="Notifications">
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  opening={open.isPending}
                  onOpen={() => open.mutate(notification)}
                />
              </li>
            ))}
          </ItemGroup>
        )}

        {inbox.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => inbox.fetchNextPage()}
              disabled={inbox.isFetchingNextPage}
            >
              {inbox.isFetchingNextPage && <Spinner data-icon="inline-start" />}
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function NotificationItem({
  notification,
  opening,
  onOpen,
}: {
  notification: Notification;
  opening: boolean;
  onOpen: () => void;
}) {
  const unread = !notification.readAt;
  return (
    <Item variant={unread ? "outline" : "muted"} size="sm">
      <ItemMedia>
        <span
          className={cn("size-2 rounded-full", unread ? "bg-primary" : "bg-transparent")}
          aria-hidden
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <p className={cn("text-xs font-medium break-words", !unread && "text-muted-foreground")}>
          {unread && <span className="sr-only">Unread: </span>}
          {notification.title}
        </p>
        <ItemDescription>{notification.body}</ItemDescription>
        <time
          dateTime={new Date(notification.createdAt).toISOString()}
          className="text-muted-foreground tabular-nums"
        >
          {new Date(notification.createdAt).toISOString().slice(0, 16).replace("T", " ")}
        </time>
      </ItemContent>
      {notification.link && (
        <ItemActions>
          <Button size="sm" variant="outline" disabled={opening} onClick={onOpen}>
            Open
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Button>
        </ItemActions>
      )}
    </Item>
  );
}
