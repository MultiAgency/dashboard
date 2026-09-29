import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Badge } from "@/components";
import { AssignmentsSection } from "@/components/admin/assignments-section";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { ProjectBillingsSection } from "@/components/admin/project-billings";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { useMeRoles } from "@/hooks/use-me-roles";
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
  const { agencyDao, isLoaded } = useMeRoles();
  const projectQuery = useQuery(
    clientPortalProjectDetailQueryOptions(apiClient, engagement.id, slug),
  );
  const subcontract = engagement.kind === "subcontract";
  const working = subcontract && engagement.status === "active";

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

      {subcontract && (
        <section className="space-y-3">
          <AssignmentsSection projectId={project.id} readOnly={!working} />
        </section>
      )}

      {!subcontract && contributors && contributors.length > 0 && (
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

      {working && isLoaded && !agencyDao && <ConnectTreasuryPrompt />}

      {working && agencyDao ? (
        <ProjectBillingsSection projectId={project.id} contributors={contributors ?? []} />
      ) : (
        <BillingsAdminSection readOnly engagementId={engagement.id} fixedProjectId={project.id} />
      )}
    </div>
  );
}
