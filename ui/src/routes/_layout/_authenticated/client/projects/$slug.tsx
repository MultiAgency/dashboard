import { useQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, notFound } from "@tanstack/react-router";
import { Badge } from "@/components";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectDetailQueryOptions } from "@/lib/queries";

const clientPortalRoute = getRouteApi("/_layout/_authenticated/client");

export const Route = createFileRoute("/_layout/_authenticated/client/projects/$slug")({
  loader: async ({ context, params, location }) => {
    const agencyDaoAccountId = new URLSearchParams(location.search).get("agency");
    if (!agencyDaoAccountId) return null;
    const data = await context.queryClient
      .ensureQueryData(
        clientPortalProjectDetailQueryOptions(context.apiClient, agencyDaoAccountId, params.slug),
      )
      .catch(() => null);
    if (!data) return null;
    return data;
  },
  component: ClientProjectDetailPage,
});

function ClientProjectDetailPage() {
  const { slug } = Route.useParams();
  const { client, agencyDaoAccountId } = clientPortalRoute.useRouteContext();
  const apiClient = useApiClient();
  const search = { agency: agencyDaoAccountId };

  const projectQuery = useQuery(
    clientPortalProjectDetailQueryOptions(apiClient, agencyDaoAccountId, slug),
  );
  const projectId = projectQuery.data?.project.id;

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
          to="/client/projects"
          search={search}
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← your projects
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

      {projectId && (
        <ProjectBudgetPanel
          projectId={projectId}
          readOnly
          clientPortal
          agencyDaoAccountId={agencyDaoAccountId}
        />
      )}

      {projectId && (
        <BillingsAdminSection
          readOnly
          clientPortal
          clientId={client.id}
          agencyDaoAccountId={agencyDaoAccountId}
          fixedProjectId={projectId}
        />
      )}
    </div>
  );
}
