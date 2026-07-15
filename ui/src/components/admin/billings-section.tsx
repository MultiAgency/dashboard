import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, DataTable } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, selectClass } from "@/components/admin-form";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { adminContributorsListQueryOptions, adminProjectsListQueryOptions } from "@/lib/queries";

type Billing = Awaited<ReturnType<ApiClient["billings"]["list"]>>["data"][number];

export function BillingsAdminSection() {
  const apiClient = useApiClient();
  const [projectId, setProjectId] = useState("");
  const [contributorId, setContributorId] = useState("");

  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));

  const billingsQuery = useInfiniteQuery({
    queryKey: ["admin", "billings", "list", projectId || null, contributorId || null],
    queryFn: ({ pageParam }) =>
      apiClient.billings.list({
        projectId: projectId || undefined,
        contributorId: contributorId || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  if (billingsQuery.isError) {
    return <AdminError error={billingsQuery.error} />;
  }

  const billings = useMemo(
    () => billingsQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [billingsQuery.data],
  );
  const projects = projectsQuery.data?.data ?? [];
  const contributors = contributorsQuery.data?.data ?? [];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const contributorById = new Map(contributors.map((c) => [c.id, c]));
  const filtersActive = projectId !== "" || contributorId !== "";

  const columns: ColumnDef<Billing>[] = [
    {
      id: "proposalId",
      header: "Proposal",
      accessorKey: "proposalId",
      cell: ({ row }) => <span className="font-mono text-xs">#{row.original.proposalId}</span>,
    },
    {
      id: "project",
      header: "Project",
      accessorFn: (row) => projectById.get(row.projectId)?.title ?? row.projectId,
      cell: ({ row }) => {
        const project = projectById.get(row.original.projectId);
        return project ? (
          <Link
            to="/admin/projects/$slug"
            params={{ slug: project.slug }}
            className="underline hover:text-foreground text-sm"
          >
            {project.title}
          </Link>
        ) : (
          <span className="font-mono text-xs">{row.original.projectId}</span>
        );
      },
    },
    {
      id: "contributor",
      header: "Contributor",
      accessorFn: (row) =>
        row.contributorId
          ? (contributorById.get(row.contributorId)?.name ?? row.contributorId)
          : "",
      cell: ({ row }) => {
        const c = row.original.contributorId
          ? contributorById.get(row.original.contributorId)
          : null;
        return <span className="text-sm">{c?.name ?? "—"}</span>;
      },
    },
    {
      id: "amount",
      header: "Amount",
      accessorKey: "amount",
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
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="project" htmlFor="filter-project">
            <select
              id="filter-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={selectClass}
            >
              <option value="">all projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="contributor" htmlFor="filter-contributor">
            <select
              id="filter-contributor"
              value={contributorId}
              onChange={(e) => setContributorId(e.target.value)}
              className={selectClass}
            >
              <option value="">all contributors</option>
              {contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!filtersActive}
              onClick={() => {
                setProjectId("");
                setContributorId("");
              }}
            >
              reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={billings}
        isLoading={billingsQuery.isLoading}
        error={billingsQuery.error}
        onRetry={() => billingsQuery.refetch()}
        emptyMessage={
          filtersActive
            ? "No billings match the current filters."
            : "No billings recorded yet. Record them from a project detail page."
        }
        csvFilename="billings"
        viewId="admin-billings"
        searchPlaceholder="Search billings…"
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
    </div>
  );
}
