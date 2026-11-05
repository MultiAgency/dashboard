import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { LoadError } from "@/components/load-error";
import { SectionHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkOrder } from "@/components/work-orders/work-order-status";
import { waitingPhrase } from "@/lib/work-orders-inbox";

function builderName(workOrder: WorkOrder): string {
  return workOrder.builder.name ?? workOrder.builder.nearAccount;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function WaitingOnYouList({
  workOrders,
  isLoading,
  error,
  onRetry,
}: {
  workOrders: WorkOrder[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="waiting-on-you" className="flex flex-col gap-3">
      <SectionHeader id="waiting-on-you" title="Work orders waiting on you" />
      {error ? (
        <LoadError title="Could not load work orders" onRetry={onRetry} />
      ) : isLoading ? (
        <ListSkeleton />
      ) : workOrders.length === 0 ? (
        <p className="border px-4 py-3 text-sm text-muted-foreground">
          No work orders are waiting on you.
        </p>
      ) : (
        <ItemGroup>
          {workOrders.map((workOrder) => (
            <li key={workOrder.id}>
              <Item variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    {workOrder.code}
                    <span className="font-normal text-muted-foreground">
                      {builderName(workOrder)}
                    </span>
                  </ItemTitle>
                  <ItemDescription>{workOrder.progress.headline}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm">
                    <Link to="/admin/work-orders/$id" params={{ id: workOrder.id }}>
                      {workOrder.progress.next?.label ?? "Open"}
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

export function InProgressList({ workOrders }: { workOrders: WorkOrder[] }) {
  if (workOrders.length === 0) return null;
  return (
    <section aria-labelledby="in-progress" className="flex flex-col gap-3">
      <SectionHeader
        id="in-progress"
        title="In progress"
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/work-orders" search={{ view: "all" }}>
              All work orders
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        }
      />
      <ItemGroup>
        {workOrders.map((workOrder) => (
          <li key={workOrder.id}>
            <Item asChild variant="outline" size="xs">
              <Link to="/admin/work-orders/$id" params={{ id: workOrder.id }}>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    {workOrder.code}
                    <span className="font-normal text-muted-foreground">
                      {builderName(workOrder)}
                    </span>
                  </ItemTitle>
                </ItemContent>
                <span className="text-muted-foreground">
                  {waitingPhrase(workOrder.progress.waitingOn, builderName(workOrder)) ??
                    "In progress"}
                </span>
              </Link>
            </Item>
          </li>
        ))}
      </ItemGroup>
    </section>
  );
}
