import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  PageHeader,
} from "@/components";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import {
  RenewalBadge,
  type WorkOrder,
  WorkOrderStatusBadge,
} from "@/components/work-orders/work-order-status";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { adminWorkOrdersQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/work-orders/")({
  head: () => ({
    meta: [
      { title: "Work orders" },
      {
        name: "description",
        content:
          "Signed work orders: a period, a budget cap and the repositories in scope per builder.",
      },
    ],
  }),
  component: WorkOrdersPage,
});

const columns: ColumnDef<WorkOrder>[] = [
  {
    id: "code",
    header: "Work order",
    accessorKey: "code",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          to="/admin/work-orders/$id"
          params={{ id: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.code}
        </Link>
        <span className="text-xs text-muted-foreground">{row.original.title}</span>
      </div>
    ),
  },
  {
    id: "builder",
    header: "Builder",
    accessorFn: (row) => row.builder.name ?? row.builder.nearAccount,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{row.original.builder.name ?? row.original.builder.nearAccount}</span>
        <span className="text-xs text-muted-foreground">
          {row.original.builder.githubLogin
            ? `@${row.original.builder.githubLogin}`
            : "no GitHub login"}
        </span>
      </div>
    ),
  },
  { id: "project", header: "Project", accessorKey: "projectTitle" },
  {
    id: "period",
    header: "Period",
    accessorFn: (row) => row.periodStart,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
        {row.original.periodStart} → {row.original.periodEnd}
      </span>
    ),
  },
  {
    id: "budget",
    header: "Committed",
    accessorFn: (row) => row.committedAmount,
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatTokenAmount(row.original.committedAmount, row.original.tokenId)} of{" "}
        {formatTokenAmount(row.original.budgetAmount, row.original.tokenId)}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <WorkOrderStatusBadge status={row.original.status} />
        {row.original.waiting > 0 && <Badge>{row.original.waiting} waiting</Badge>}
        {row.original.renewal && row.original.renewal.status !== "renewed" && (
          <RenewalBadge status={row.original.renewal.status} />
        )}
        {row.original.renewedFrom && <Badge variant="secondary">Renewal</Badge>}
      </div>
    ),
  },
];

function WorkOrdersPage() {
  const apiClient = useApiClient();
  const navigate = useNavigate();
  const { canAccessAdmin: canManage } = useMeRoles();
  const query = useQuery(adminWorkOrdersQueryOptions(apiClient));
  const workOrders = query.data?.data ?? [];
  const waiting = workOrders.filter((w) => w.renewal?.status === "needs_approval");
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Work orders"
        description="Each builder works under a work order: a period, a budget cap and the repositories in scope. Work counts once the repository owner approves or merges it on GitHub; approved requests are paid automatically by your payout agent once it's set up, otherwise through your Agency DAO."
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              New work order
            </Button>
          )
        }
      />

      {waiting.length > 0 && (
        <Alert>
          <AlertTitle>Manual Approval Needed</AlertTitle>
          <AlertDescription>
            <span>
              {waiting.length === 1 ? "A work order" : `${waiting.length} work orders`} missed a
              base metric for renewal:{" "}
              {waiting.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ", "}
                  <Link
                    to="/admin/work-orders/$id"
                    params={{ id: w.id }}
                    className="font-medium underline underline-offset-4"
                  >
                    {w.code}
                  </Link>
                </span>
              ))}
              . Renew it anyway or let it end.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        readOnly
        columns={columns}
        data={workOrders}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        emptyMessage="No work orders yet."
        csvFilename="work-orders"
        viewId="admin-work-orders"
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {creating && (
            <WorkOrderForm
              onDone={(workOrder) => {
                setCreating(false);
                void navigate({ to: "/admin/work-orders/$id", params: { id: workOrder.id } });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
