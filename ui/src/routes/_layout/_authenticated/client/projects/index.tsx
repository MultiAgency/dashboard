import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/projects/")({
  component: ClientProjectsPage,
});

function ClientProjectsPage() {
  const { agencyDaoAccountId } = Route.useRouteContext();
  const apiClient = useApiClient();
  const projectsQuery = useQuery(
    clientPortalProjectsListQueryOptions(apiClient, agencyDaoAccountId),
  );
  const projects = projectsQuery.data?.data ?? [];
  const search = { agency: agencyDaoAccountId };

  const columns: ColumnDef<(typeof projects)[number]>[] = [
    {
      id: "title",
      header: "Project",
      accessorKey: "title",
      cell: ({ row }) => (
        <Link
          to="/client/projects/$slug"
          params={{ slug: row.original.slug }}
          search={search}
          className="font-display text-sm uppercase font-bold hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      accessorKey: "slug",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">@{row.original.slug}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        your projects
      </h2>
      <DataTable
        readOnly
        columns={columns}
        data={projects}
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error}
        onRetry={() => projectsQuery.refetch()}
        emptyMessage="No projects linked to your client account yet."
        csvFilename="client-projects"
        viewId="client-projects"
      />
    </div>
  );
}
