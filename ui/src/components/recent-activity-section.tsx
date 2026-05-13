import { useQuery } from "@tanstack/react-query";
import { Empty, EmptyTitle } from "@/components";
import { allocationVerb, VerbTag } from "@/components/allocation-verb";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";

export function RecentActivitySection() {
  const apiClient = useApiClient();
  const activityQuery = useQuery({
    queryKey: ["admin", "allocations", "recent"],
    queryFn: () => apiClient.allocations.adminList({ limit: 5 }),
    retry: false,
  });

  const rows = activityQuery.data?.data ?? [];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          operator · activity
        </div>
        <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight font-extrabold leading-tight">
          Recent Activity
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Latest allocation events across all projects.
        </p>
      </div>
      {activityQuery.isLoading ? (
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          loading activity…
        </div>
      ) : activityQuery.isError ? (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-mono text-sm font-normal text-muted-foreground">
            Activity unavailable.
          </EmptyTitle>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-mono text-sm font-normal text-muted-foreground">
            No activity yet. Allocate below to start the audit log.
          </EmptyTitle>
        </Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div
              key={a.id}
              className="rounded-sm border border-border bg-muted/10 p-3 grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4"
            >
              <div className="text-xs font-mono text-muted-foreground">
                {new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}
              </div>
              <div className="text-sm break-all space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <VerbTag verb={allocationVerb(a.amount, a.relatedAllocationId)} />
                  <span className="font-mono tabular-nums">
                    {formatTokenAmount(a.amount, a.tokenId)}
                  </span>
                </div>
                {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                <div className="text-xs text-muted-foreground font-mono">by {a.actorAccountId}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
