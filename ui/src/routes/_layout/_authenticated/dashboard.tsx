import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable, PageHeader, SectionHeader, Spinner } from "@/components";
import { WorkOrderStatusBadge } from "@/components/work-orders/work-order-status";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { myAssignedProjectsQueryOptions, myWorkOrdersQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My work" },
      { name: "description", content: "Projects assigned to you and your billings." },
    ],
  }),
  component: MyWorkPage,
});

type AssignedProject = Awaited<ReturnType<ApiClient["me"]["assignedProjects"]>>["data"][number];
type MyBilling = Awaited<ReturnType<ApiClient["me"]["billings"]>>["data"][number];
type MyWorkOrder = Awaited<ReturnType<ApiClient["myWorkOrders"]["list"]>>["data"][number];

const workOrderColumns: ColumnDef<MyWorkOrder>[] = [
  {
    id: "code",
    header: "Work order",
    accessorKey: "code",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <Link
          to="/work-orders/$id"
          params={{ id: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.code}
        </Link>
        <span className="text-xs text-muted-foreground">
          {row.original.projectTitle} · {row.original.agencyName}
        </span>
      </div>
    ),
  },
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
    id: "left",
    header: "Left",
    accessorFn: (row) => row.remainingAmount,
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatTokenAmount(row.original.remainingAmount, row.original.tokenId)} of{" "}
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
        {row.original.status === "offered" && <Badge>Your answer needed</Badge>}
        {row.original.progress?.stage === "request" &&
          row.original.progress.waitingOn === "builder" && <Badge>Submit your request</Badge>}
      </div>
    ),
  },
];

function MyWorkPage() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(myAssignedProjectsQueryOptions(apiClient));
  const workOrdersQuery = useQuery(myWorkOrdersQueryOptions(apiClient));
  const workOrders = (workOrdersQuery.data?.data ?? []).filter((w) => w.status !== "draft");
  const billingsQuery = useInfiniteQuery({
    queryKey: ["me", "billings"],
    queryFn: ({ pageParam }) => apiClient.me.billings({ cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const projects = projectsQuery.data?.data ?? [];
  const billings = billingsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const projectColumns: ColumnDef<AssignedProject>[] = [
    { id: "project", header: "Project", accessorKey: "projectTitle" },
    { id: "agency", header: "Agency", accessorKey: "agencyName" },
    {
      id: "role",
      header: "Role",
      accessorFn: (row) => row.role ?? "",
    },
  ];

  const billingColumns: ColumnDef<MyBilling>[] = [
    {
      id: "project",
      header: "Project",
      accessorFn: (row) => row.projectTitle ?? row.projectId,
    },
    { id: "agency", header: "Agency", accessorFn: (row) => row.agencyName ?? "" },
    {
      id: "amount",
      header: "Amount",
      accessorKey: "amount",
      meta: { exportValue: (row: MyBilling) => formatTokenAmount(row.amount, row.tokenId) },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatTokenAmount(row.original.amount, row.original.tokenId)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
    {
      id: "createdAt",
      header: "Created",
      accessorFn: (row) => new Date(row.createdAt).toISOString(),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {new Date(row.original.createdAt).toISOString().slice(0, 10)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader
        title="My work"
        description={
          <>
            Projects any Agency assigned to the NEAR accounts linked on your{" "}
            <Link to="/profile" className="text-foreground underline underline-offset-4">
              profile
            </Link>
            , and the billings paid to them.
          </>
        }
      />

      <section className="flex flex-col gap-3" aria-labelledby="my-assigned-projects">
        <SectionHeader
          id="my-assigned-projects"
          title="Assigned Projects"
          description="Projects you are assigned to, with your role."
        />
        <DataTable
          readOnly
          columns={projectColumns}
          data={projects}
          isLoading={projectsQuery.isLoading}
          error={projectsQuery.error}
          onRetry={() => projectsQuery.refetch()}
          emptyMessage="No Project is assigned to your NEAR accounts yet."
          csvFilename="my-projects"
          viewId="my-projects"
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="my-work-orders">
        <SectionHeader
          id="my-work-orders"
          title="Work orders"
          description="Your terms with each Agency: the period, budget and repositories, and your compensation requests."
        />
        <DataTable
          readOnly
          columns={workOrderColumns}
          data={workOrders}
          isLoading={workOrdersQuery.isLoading}
          error={workOrdersQuery.error}
          onRetry={() => workOrdersQuery.refetch()}
          emptyMessage="No work orders offered to your NEAR accounts yet."
          csvFilename="my-work-orders"
          viewId="my-work-orders"
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="my-billings">
        <SectionHeader
          id="my-billings"
          title="My billings"
          description="Billings paid to your NEAR accounts, newest first."
        />
        <DataTable
          readOnly
          columns={billingColumns}
          data={billings}
          isLoading={billingsQuery.isLoading}
          error={billingsQuery.error}
          onRetry={() => billingsQuery.refetch()}
          emptyMessage="No billings paid to your NEAR accounts yet."
          csvFilename="my-billings"
          viewId="my-billings"
        />
        {billingsQuery.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => billingsQuery.fetchNextPage()}
              disabled={billingsQuery.isFetchingNextPage}
            >
              {billingsQuery.isFetchingNextPage && <Spinner data-icon="inline-start" />}
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
