import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable, PageHeader } from "@/components";
import { type ApiClient, useApiClient } from "@/lib/api";
import { canReadEngagement } from "@/lib/navigation";
import { clientPortalAllProjectsQueryOptions, engagementsListQueryOptions } from "@/lib/queries";

type SharedProject = Awaited<
  ReturnType<ApiClient["clientPortal"]["projects"]["listAll"]>
>["data"][number];

export const Route = createFileRoute("/_layout/_authenticated/client/projects")({
  head: () => ({
    meta: [
      { title: "Projects" },
      { name: "description", content: "Every Project your Agencies share with you." },
    ],
  }),
  component: ClientProjectsPage,
});

function ClientProjectsPage() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(clientPortalAllProjectsQueryOptions(apiClient));
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const agencyNames = new Map(
    (engagementsQuery.data?.data ?? [])
      .filter((e) => e.side === "client" && canReadEngagement(e.status))
      .map((e) => [e.id, e.agency.name]),
  );
  const projects = projectsQuery.data?.data ?? [];

  const columns: ColumnDef<SharedProject>[] = [
    {
      id: "title",
      header: "Project",
      accessorFn: (row) => row.project.title,
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Link
            to="/client/$engagementId/projects/$slug"
            params={{ engagementId: row.original.engagementId, slug: row.original.project.slug }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.project.title}
          </Link>
          <span className="text-muted-foreground">@{row.original.project.slug}</span>
        </div>
      ),
    },
    {
      id: "agency",
      header: "Agency",
      accessorFn: (row) => agencyNames.get(row.engagementId) ?? "",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {agencyNames.get(row.original.engagementId) ?? "—"}
        </span>
      ),
    },
    {
      id: "builders",
      header: "Builders",
      accessorFn: (row) => row.contributors.map((c) => c.name).join(", "),
      cell: ({ row }) =>
        row.original.contributors.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.contributors.map((c) => (
              <Badge key={c.nearAccount} variant="outline" title={c.role ?? undefined}>
                {c.name}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => row.project.status,
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant="outline">{row.original.project.status}</Badge>
          {row.original.readOnly && <Badge variant="secondary">read-only</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Every Project your Agencies share with you, and the builders working on it."
        actions={
          <Button asChild variant="outline">
            <Link to="/client/reports">Reports</Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={projects}
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error}
        onRetry={() => projectsQuery.refetch()}
        emptyMessage="No Agency has shared a Project with you yet."
        csvFilename="projects"
        viewId="client-all-projects"
        searchPlaceholder="Search projects…"
      />
    </div>
  );
}
