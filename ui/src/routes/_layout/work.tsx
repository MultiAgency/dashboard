import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyTitle,
  Skeleton,
} from "@/components";
import { ProjectsAdminSection } from "@/components/projects-admin-section";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { nearnListingUrl, nearnSponsorUrl } from "@/lib/nearn";
import { projectsListQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/work")({
  head: () => ({
    meta: [{ title: "Work" }, { name: "description", content: "Active projects." }],
  }),
  component: WorkIndex,
});

type ProjectListItem = {
  id: string;
  slug: string;
  title: string;
  status: string;
  nearnListingId: string | null;
  nearnListing: {
    status?: string | null;
    type?: string | null;
    description?: string | null;
    rewardAmount?: number | null;
    token?: string | null;
    deadline?: string | null;
  } | null;
};

function WorkIndex() {
  const apiClient = useApiClient();
  const { isOperator, isAdmin, isLoaded } = useMeRoles();
  const projectsQuery = useQuery({
    ...projectsListQueryOptions(apiClient),
    staleTime: 30_000,
  });
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));

  const nearnUrl = settingsQuery.data?.nearnAccountId
    ? nearnSponsorUrl(settingsQuery.data.nearnAccountId)
    : null;

  return (
    <div className="space-y-12 pb-12 animate-fade-in">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              agency · work
            </div>
            <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
              Our Work
            </h1>
          </div>
          {nearnUrl && (
            <Button asChild variant="outline" className="font-display uppercase tracking-wide">
              <a href={nearnUrl} target="_blank" rel="noopener noreferrer">
                nearn →
              </a>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Active projects. Open work, listings, and applications live on NEARN.
        </p>
      </header>

      {projectsQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : projectsQuery.isError ? (
        <div
          role="alert"
          className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
        >
          <span>could not load</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => projectsQuery.refetch()}
            className="font-display uppercase tracking-wide"
          >
            try again
          </Button>
        </div>
      ) : projectsQuery.data && projectsQuery.data.data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(projectsQuery.data.data as ProjectListItem[]).map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
            no public projects yet
          </EmptyTitle>
          <EmptyDescription className="font-mono text-xs uppercase tracking-wide">
            check back as the agency boots up.
          </EmptyDescription>
          <EmptyContent>
            <Button asChild className="font-display uppercase tracking-wide">
              <Link to="/apply">apply →</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {isLoaded && isOperator && (
        <section className="space-y-6">
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              operator · projects
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
              Manage Projects
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Create, edit, and assign contributors to projects. Visibility and status control what
              appears in the public list above.
            </p>
            {isAdmin && (
              <div className="pt-1">
                <Link
                  to="/settings"
                  hash="nearn"
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
                >
                  edit nearn config →
                </Link>
              </div>
            )}
          </div>
          <ProjectsAdminSection />
        </section>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  const n = project.nearnListing;
  const nearnHref = project.nearnListingId ? nearnListingUrl(project.nearnListingId) : null;
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">@{project.slug}</span>
          <span>{project.status}</span>
        </div>
        <h2 className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
          {project.title}
        </h2>
        {n?.description && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
            {n.description}
          </p>
        )}
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground space-y-1">
          {n?.status && <div>nearn · {n.status}</div>}
          {n?.type && <div>type · {n.type}</div>}
          {n?.rewardAmount !== undefined && n?.rewardAmount !== null && n?.token && (
            <div>
              reward · <span className="tabular-nums">{n.rewardAmount}</span> {n.token}
            </div>
          )}
          {n?.deadline && <div>deadline · {new Date(n.deadline).toISOString().slice(0, 10)}</div>}
        </div>
        {nearnHref && (
          <div className="mt-auto pt-2">
            <Button
              asChild
              variant="outline"
              className="w-full font-display uppercase tracking-wide"
            >
              <a href={nearnHref} target="_blank" rel="noopener noreferrer">
                open →
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
        <div className="mt-auto pt-2">
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
