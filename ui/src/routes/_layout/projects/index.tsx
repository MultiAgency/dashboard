import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components";
import { nearnListingUrl, nearnSponsorUrl } from "@/lib/nearn";
import { useApiClient } from "@/lib/use-api-client";

export const Route = createFileRoute("/_layout/projects/")({
  head: () => ({
    meta: [{ title: "Projects" }, { name: "description", content: "Active projects." }],
  }),
  component: ProjectsIndex,
});

function ProjectsIndex() {
  const apiClient = useApiClient();
  const projectsQuery = useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => apiClient.projects.list(),
    staleTime: 30_000,
  });
  const settingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });

  const nearnUrl = settingsQuery.data?.nearnAccountId
    ? nearnSponsorUrl(settingsQuery.data.nearnAccountId)
    : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Active projects. Open work, listings, and applications live on NEARN.
          </p>
        </div>
        {nearnUrl && (
          <Button asChild variant="outline">
            <a href={nearnUrl} target="_blank" rel="noopener noreferrer">
              view all on NEARN
              <ArrowUpRight className="w-4 h-4 ml-1" />
            </a>
          </Button>
        )}
      </header>

      {projectsQuery.isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Loading projects...
          </CardContent>
        </Card>
      ) : projectsQuery.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Could not load projects.
          </CardContent>
        </Card>
      ) : projectsQuery.data && projectsQuery.data.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectsQuery.data.data.map((p) => {
            const n = p.nearnListing;
            const nearnHref = p.nearnListingId ? nearnListingUrl(p.nearnListingId) : null;
            return (
              <Card key={p.id} className="h-full flex flex-col">
                <CardContent className="p-5 space-y-3 flex flex-col flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={p.status === "active" ? "default" : "outline"}>
                      {p.status}
                    </Badge>
                    {n?.status && <Badge variant="outline">NEARN: {n.status}</Badge>}
                    {n?.type && <Badge variant="outline">{n.type}</Badge>}
                  </div>
                  <h2 className="font-semibold tracking-tight break-all">{p.title}</h2>
                  <div className="text-xs font-mono text-muted-foreground">@{p.slug}</div>
                  {n?.description && (
                    <p className="text-sm text-muted-foreground line-clamp-3">{n.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1 font-mono">
                    {n?.rewardAmount !== undefined && n?.rewardAmount !== null && n?.token && (
                      <div>
                        reward: {n.rewardAmount} {n.token}
                      </div>
                    )}
                    {n?.deadline && (
                      <div>deadline: {new Date(n.deadline).toISOString().slice(0, 10)}</div>
                    )}
                  </div>
                  {nearnHref && (
                    <div className="pt-2 mt-auto">
                      <Button asChild variant="outline" size="sm" className="w-full">
                        <a href={nearnHref} target="_blank" rel="noopener noreferrer">
                          view on nearn
                          <ArrowUpRight className="w-3 h-3 ml-1" />
                        </a>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <Badge variant="outline">no public projects yet</Badge>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
              No projects have been published yet. Reach out if you'd like to engage.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link to="/apply">express interest</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
