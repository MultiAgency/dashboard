import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { adminWorkOrdersQueryKey, workspaceKey } from "@/lib/queries";
import { RenewalBadge, WorkOrderStatusBadge } from "./work-order-status";

export function WorkOrdersCard({
  filter,
  description,
}: {
  filter: { builderNearAccount: string } | { projectId: string };
  description: string;
}) {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: [...adminWorkOrdersQueryKey, "filtered", ...workspaceKey(), filter] as const,
    queryFn: () => apiClient.workOrders.list(filter),
    retry: false,
  });
  const workOrders = query.data?.data ?? [];
  if (query.isError || (query.isSuccess && workOrders.length === 0)) return null;
  const showBuilder = "projectId" in filter;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Work orders</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {workOrders.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Link
                to="/admin/work-orders/$id"
                params={{ id: w.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {w.code}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {showBuilder ? (w.builder.name ?? w.builder.nearAccount) : w.projectTitle} ·{" "}
                {w.periodStart} → {w.periodEnd}
              </span>
              <span className="tabular-nums">
                {formatTokenAmount(w.committedAmount, w.tokenId)} of{" "}
                {formatTokenAmount(w.budgetAmount, w.tokenId)}
              </span>
              <WorkOrderStatusBadge status={w.status} />
              {w.renewal && w.renewal.status !== "renewed" && (
                <RenewalBadge status={w.renewal.status} />
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
