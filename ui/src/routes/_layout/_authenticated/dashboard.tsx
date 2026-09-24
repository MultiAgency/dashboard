import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable } from "@/components";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { myAssignedProjectsQueryOptions } from "@/lib/queries";

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

function MyWorkPage() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(myAssignedProjectsQueryOptions(apiClient));
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
    {
      id: "onboarding",
      header: "Onboarding",
      accessorKey: "onboardingStatus",
      cell: ({ row }) => <Badge variant="outline">{row.original.onboardingStatus}</Badge>,
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
        <span className="font-mono text-sm">
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
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(row.original.createdAt).toISOString().slice(0, 10)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          you · my work
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          My work
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Projects any Agency assigned to the NEAR accounts linked on your{" "}
          <Link to="/profile" className="underline underline-offset-2">
            profile
          </Link>
          , and the billings paid to them.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-xl uppercase font-extrabold">Assigned projects</h2>
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

      <section className="space-y-3">
        <h2 className="font-display text-xl uppercase font-extrabold">My billings</h2>
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
              {billingsQuery.isFetchingNextPage ? "loading..." : "load more"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
