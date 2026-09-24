import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Badge } from "@/components";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectDetailQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/projects/$slug")(
  {
    component: SharedProjectPage,
  },
);

function SharedProjectPage() {
  const { slug } = Route.useParams();
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const projectQuery = useQuery(
    clientPortalProjectDetailQueryOptions(apiClient, engagement.id, slug),
  );

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }
  if (projectQuery.isError || !projectQuery.data) {
    throw notFound();
  }

  const { project, contributors } = projectQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/client/$engagementId/projects"
          params={{ engagementId: engagement.id }}
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← shared projects
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{project.status}</Badge>
          <Badge variant="outline">{project.kind}</Badge>
        </div>
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <div className="font-mono text-xs text-muted-foreground">@{project.slug}</div>
      </header>

      {project.description && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{project.description}</p>
        </section>
      )}

      {contributors && contributors.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Builders</h2>
          <ul className="space-y-1 text-sm">
            {contributors.map((c) => (
              <li key={c.nearAccount}>
                {c.name}
                {c.role ? <span className="text-muted-foreground"> · {c.role}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProjectBudgetPanel projectId={project.id} readOnly engagementId={engagement.id} />

      <BillingsAdminSection readOnly engagementId={engagement.id} fixedProjectId={project.id} />
    </div>
  );
}
