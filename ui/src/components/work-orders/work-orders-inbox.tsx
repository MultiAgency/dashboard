import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { type MouseEvent, useMemo, useState } from "react";
import { LoadError } from "@/components/load-error";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type WorkOrder, WorkOrderStatusBadge } from "@/components/work-orders/work-order-status";
import { formatTokenAmount } from "@/lib/format-amount";
import { periodHint, periodRange } from "@/lib/format-date";
import {
  defaultInboxView,
  filterInbox,
  INBOX_EMPTY,
  INBOX_VIEW_LABELS,
  INBOX_VIEWS,
  type InboxView,
  type InboxWaiting,
  inboxCounts,
  isInboxView,
  relativeSince,
  waitingPhrase,
} from "@/lib/work-orders-inbox";

const WAITING_DOT: Record<NonNullable<InboxWaiting> | "none", string> = {
  you: "bg-primary",
  builder: "bg-chart-4",
  system: "bg-muted-foreground",
  dao: "bg-foreground",
  none: "bg-border",
};

function builderName(workOrder: WorkOrder): string {
  return workOrder.builder.name ?? workOrder.builder.nearAccount;
}

function fromInteractive(event: MouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element && event.target.closest("a, button") !== null;
}

function CodeLink({ workOrder, stretched }: { workOrder: WorkOrder; stretched?: boolean }) {
  return (
    <Link
      to="/admin/work-orders/$id"
      params={{ id: workOrder.id }}
      className={cn(
        "font-medium underline-offset-4 hover:underline",
        stretched && "after:absolute after:inset-0",
      )}
    >
      {workOrder.code}
    </Link>
  );
}

function StatusLine({ workOrder }: { workOrder: WorkOrder }) {
  return (
    <div className="flex flex-wrap gap-1 [&_[data-slot=badge]]:h-4 [&_[data-slot=badge]]:px-1.5 [&_[data-slot=badge]]:text-[0.625rem]">
      <WorkOrderStatusBadge status={workOrder.status} />
      {workOrder.renewedFrom && <Badge variant="secondary">Renewal</Badge>}
    </div>
  );
}

function NextAction({ workOrder }: { workOrder: WorkOrder }) {
  const navigate = useNavigate();
  const next = workOrder.progress.next;
  if (!workOrder.progress.needsYou || !next) return null;
  if (next.kind === "link" && next.external) {
    return (
      <Button asChild size="xs" className="relative z-10">
        <a href={next.href} target="_blank" rel="noopener noreferrer">
          {next.label}
          <ArrowUpRightIcon aria-hidden />
        </a>
      </Button>
    );
  }
  if (next.kind === "link") {
    return (
      <Button asChild size="xs" className="relative z-10">
        <a
          href={next.href}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            void navigate({ href: next.href });
          }}
        >
          {next.label}
        </a>
      </Button>
    );
  }
  return (
    <Button asChild size="xs" className="relative z-10">
      <Link to="/admin/work-orders/$id" params={{ id: workOrder.id }}>
        {next.label}
        <ArrowRightIcon aria-hidden />
      </Link>
    </Button>
  );
}

function waitingText(workOrder: WorkOrder): string {
  return waitingPhrase(workOrder.progress.waitingOn, builderName(workOrder)) ?? "Done";
}

function NextStep({ workOrder }: { workOrder: WorkOrder }) {
  const { waitingOn, headline, since } = workOrder.progress;
  const ago = relativeSince(since);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", WAITING_DOT[waitingOn ?? "none"])}
        />
        <span
          className={cn(
            "truncate font-medium",
            waitingOn === "you" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {waitingText(workOrder)}
        </span>
        {ago && since && (
          <time
            dateTime={since}
            title={new Date(since).toLocaleString()}
            className="shrink-0 text-muted-foreground tabular-nums"
          >
            · {ago}
          </time>
        )}
      </div>
      <p
        className={cn(
          "line-clamp-2 text-pretty",
          waitingOn === "you" ? "text-foreground" : "text-muted-foreground",
        )}
        title={headline}
      >
        {headline}
      </p>
      <div className="empty:hidden">
        <NextAction workOrder={workOrder} />
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name
    .replace(/\.near$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function BuilderCell({ workOrder }: { workOrder: WorkOrder }) {
  const name = builderName(workOrder);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar size="sm">
        <AvatarFallback className="text-[0.625rem]">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate" title={name}>
          {name}
        </span>
        <span className="truncate text-muted-foreground text-xs" title={workOrder.projectTitle}>
          {workOrder.projectTitle}
        </span>
      </div>
    </div>
  );
}

function PeriodCell({ workOrder }: { workOrder: WorkOrder }) {
  const today = new Date().toISOString().slice(0, 10);
  const hint = periodHint(workOrder.periodStart, workOrder.periodEnd, today);
  return (
    <div className="flex flex-col">
      <span
        className="whitespace-nowrap tabular-nums"
        title={`${workOrder.periodStart} → ${workOrder.periodEnd}`}
      >
        {periodRange(workOrder.periodStart, workOrder.periodEnd)}
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function share(part: string, whole: string): number {
  const total = Number(whole);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, Number(part) / total));
}

function Committed({ workOrder, bar = true }: { workOrder: WorkOrder; bar?: boolean }) {
  const used = share(workOrder.committedAmount, workOrder.budgetAmount);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="whitespace-nowrap tabular-nums">
        {formatTokenAmount(workOrder.committedAmount, workOrder.tokenId)}
        <span className="text-muted-foreground">
          {" "}
          / {formatTokenAmount(workOrder.budgetAmount, workOrder.tokenId)}
        </span>
      </span>
      {bar && (
        <div aria-hidden className="h-1 w-full max-w-24 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", used >= 1 ? "bg-muted-foreground" : "bg-primary")}
            style={{ width: `${used * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function InboxTable({ rows }: { rows: WorkOrder[] }) {
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLElement>, id: string) => {
    if (fromInteractive(event)) return;
    void navigate({ to: "/admin/work-orders/$id", params: { id } });
  };
  return (
    <div className="hidden overflow-hidden border md:block">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead scope="col" className="w-[24%] pl-4 text-muted-foreground text-xs">
              Work order
            </TableHead>
            <TableHead scope="col" className="w-[36%] text-muted-foreground text-xs">
              Next step
            </TableHead>
            <TableHead scope="col" className="w-[18%] text-muted-foreground text-xs">
              Builder
            </TableHead>
            <TableHead
              scope="col"
              className="hidden w-[11%] text-muted-foreground text-xs lg:table-cell"
            >
              Period
            </TableHead>
            <TableHead scope="col" className="w-[11%] pr-4 text-muted-foreground text-xs">
              Committed
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((workOrder) => (
            <TableRow
              key={workOrder.id}
              className={cn(
                "cursor-pointer align-top",
                workOrder.progress.needsYou && "shadow-[inset_2px_0_0_var(--color-primary)]",
              )}
              onClick={(event) => open(event, workOrder.id)}
            >
              <TableCell className="whitespace-normal py-3.5 pl-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CodeLink workOrder={workOrder} />
                    <StatusLine workOrder={workOrder} />
                  </div>
                  <span className="truncate text-muted-foreground" title={workOrder.title}>
                    {workOrder.title}
                  </span>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal py-3.5">
                <NextStep workOrder={workOrder} />
              </TableCell>
              <TableCell className="whitespace-normal py-3.5">
                <BuilderCell workOrder={workOrder} />
              </TableCell>
              <TableCell className="hidden whitespace-normal py-3.5 lg:table-cell">
                <PeriodCell workOrder={workOrder} />
              </TableCell>
              <TableCell className="whitespace-normal py-3.5 pr-4">
                <Committed workOrder={workOrder} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InboxCards({ rows }: { rows: WorkOrder[] }) {
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {rows.map((workOrder) => (
        <li
          key={workOrder.id}
          className={cn(
            "relative flex min-w-0 flex-col gap-2 border p-3 text-xs hover:bg-muted/50",
            workOrder.progress.needsYou && "border-l-2 border-l-primary",
          )}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <CodeLink workOrder={workOrder} stretched />
              <span className="truncate text-muted-foreground">{workOrder.title}</span>
            </div>
            <StatusLine workOrder={workOrder} />
          </div>
          <NextStep workOrder={workOrder} />
          <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 text-muted-foreground">
            <span className="truncate">
              {builderName(workOrder)} · {periodRange(workOrder.periodStart, workOrder.periodEnd)}
            </span>
            <Committed workOrder={workOrder} bar={false} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WorkOrdersInbox({
  workOrders,
  isLoading,
  error,
  onRetry,
  view,
  onViewChange,
  emptyAction,
}: {
  workOrders: WorkOrder[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  view?: InboxView;
  onViewChange: (view: InboxView) => void;
  emptyAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => inboxCounts(workOrders), [workOrders]);
  const active = view ?? defaultInboxView(counts);
  const rows = useMemo(() => filterInbox(workOrders, active, query), [workOrders, active, query]);

  if (error) {
    return (
      <LoadError
        title="Could not load work orders"
        description={error.message || "Check your connection and try again."}
        onRetry={onRetry}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full max-w-md" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  const searching = query.trim() !== "";
  const empty = INBOX_EMPTY[active];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          value={active}
          onValueChange={(value) => {
            if (isInboxView(value)) onViewChange(value);
          }}
          aria-label="Show work orders"
          className="flex-wrap"
        >
          {INBOX_VIEWS.map((v) => (
            <ToggleGroupItem key={v} value={v} className="gap-1.5">
              {INBOX_VIEW_LABELS[v]}
              <span className="text-muted-foreground tabular-nums">{counts[v]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <InputGroup className="w-full lg:w-64">
          <InputGroupAddon>
            <MagnifyingGlassIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            aria-label="Filter work orders"
          />
        </InputGroup>
      </div>

      {rows.length === 0 ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {searching ? <FunnelIcon aria-hidden /> : <TrayIcon aria-hidden />}
            </EmptyMedia>
            <EmptyTitle>{searching ? "No matching work orders" : empty.title}</EmptyTitle>
            <EmptyDescription>
              {searching ? "Try a different search or clear the filter." : empty.hint}
            </EmptyDescription>
          </EmptyHeader>
          {searching ? (
            <EmptyContent>
              <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear filter
              </Button>
            </EmptyContent>
          ) : (
            active === "all" && emptyAction && <EmptyContent>{emptyAction}</EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <InboxTable rows={rows} />
          <InboxCards rows={rows} />
        </>
      )}
    </div>
  );
}
