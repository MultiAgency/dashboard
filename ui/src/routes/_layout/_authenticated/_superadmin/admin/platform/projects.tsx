import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Spinner } from "@/components";
import { useApiClient } from "@/lib/api";
import { orgSiteUrl, ProjectRow } from "@/components/platform-shared";
import type { PlatformProject } from "@/components/platform-shared";

export const Route = createFileRoute("/_layout/_authenticated/_superadmin/admin/platform/projects")(
  {
    head: () => ({
      meta: [{ title: "Projects | Platform" }],
    }),
    component: PlatformProjectsPage,
  },
);

function PlatformProjectsPage() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery({
    queryKey: ["platform", "projects"],
    queryFn: () => apiClient.platform.listProjects(),
  });

  if (projectsQuery.isLoading) return <Spinner />;

  const orgs = projectsQuery.data?.orgs ?? [];
  const totalProjects = orgs.reduce((sum, org) => sum + org.projects.length, 0);

  if (orgs.length === 0) {
    return <p className="font-mono text-sm text-muted-foreground">No organizations yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {totalProjects} project{totalProjects === 1 ? "" : "s"} across {orgs.length} org
        {orgs.length === 1 ? "" : "s"}
      </div>

      <div className="space-y-6">
        {orgs.map((org) => (
          <section key={org.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-display text-lg uppercase tracking-tight font-bold">
                  {org.name}
                </div>
                <div className="font-mono text-xs text-muted-foreground">@{org.slug}</div>
              </div>
              <a href={orgSiteUrl(org.slug)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline">
                  view org →
                </Button>
              </a>
            </div>

            {org.projects.length === 0 ? (
              <p className="font-mono text-sm text-muted-foreground">No projects in this org.</p>
            ) : (
              <div className="space-y-2">
                {org.projects.map((project: PlatformProject) => (
                  <ProjectRow key={project.id} project={project} orgSlug={org.slug} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
