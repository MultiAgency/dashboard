import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@/components";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/projects/")({
  component: SharedProjectsPage,
});

function SharedProjectsPage() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const projectsQuery = useQuery(clientPortalProjectsListQueryOptions(apiClient, engagement.id));
  const projects = projectsQuery.data?.data ?? [];

  const columns: ColumnDef<(typeof projects)[number]>[] = [
    {
      id: "title",
      header: "Project",
      accessorKey: "title",
      cell: ({ row }) => (
        <Link
          to="/client/$engagementId/projects/$slug"
          params={{ engagementId: engagement.id, slug: row.original.slug }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      accessorKey: "slug",
      cell: ({ row }) => <span className="text-muted-foreground">@{row.original.slug}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
  ];

  return (
    <DataTable
      readOnly
      columns={columns}
      data={projects}
      isLoading={projectsQuery.isLoading}
      error={projectsQuery.error}
      onRetry={() => projectsQuery.refetch()}
      emptyMessage={`${engagement.agency.name} has not shared any Project with you yet.`}
      csvFilename="shared-projects"
      viewId="client-projects"
    />
  );
}
