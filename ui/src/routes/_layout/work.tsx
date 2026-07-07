import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { ProjectsAdminSection } from "@/components/projects-admin-section";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatNearnReward, nearnListingUrl, nearnSponsorUrl } from "@/lib/nearn";
import { projectsListQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/work")({
  head: () => ({
    meta: [{ title: "Work" }, { name: "description", content: "Active projects." }],
  }),
  loader: async ({ context }) => {
    const [settings, projects] = await Promise.all([
      context.queryClient
        .ensureQueryData(publicSettingsQueryOptions(context.apiClient))
        .catch(() => null),
      context.queryClient
        .ensureQueryData(projectsListQueryOptions(context.apiClient))
        .catch(() => null),
    ]);

    return { settings, projects };
  },
  component: WorkIndex,
});

type ProjectListItem = {
  id: string;
  slug: string;
  title: string;
  status: string;
  nearnListing: {
    slug: string;
    status?: string | null;
    type?: string | null;
    description?: string | null;
    rewardAmount?: number | null;
    compensationType?: string | null;
    minRewardAsk?: number | null;
    maxRewardAsk?: number | null;
    totalPaymentsMade?: number | null;
    totalWinnersSelected?: number | null;
    token?: string | null;
    deadline?: string | null;
  } | null;
};

function WorkIndex() {
  const loaderData = Route.useLoaderData();
  const apiClient = useApiClient();
  const { canAccessAdmin, isLoaded } = useMeRoles();
  const projectsQuery = useQuery({
    ...projectsListQueryOptions(apiClient),
    staleTime: 30_000,
    initialData: loaderData.projects ?? undefined,
  });
  const settingsQuery = useQuery({
    ...publicSettingsQueryOptions(apiClient),
    initialData: loaderData.settings ?? undefined,
  });

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

      {isLoaded && canAccessAdmin ? (
        <Tabs defaultValue="public">
          <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.22em]">
            <TabsTrigger value="public">public</TabsTrigger>
            <TabsTrigger value="manage">manage projects</TabsTrigger>
          </TabsList>
          <TabsContent value="public" className="mt-6">
            <PublicProjects projectsQuery={projectsQuery} />
          </TabsContent>
          <TabsContent value="manage" className="mt-6 space-y-4">
            <ProjectsAdminSection />
          </TabsContent>
        </Tabs>
      ) : (
        <PublicProjects projectsQuery={projectsQuery} />
      )}
    </div>
  );
}

type ProjectsQuery = UseQueryResult<{ data: ProjectListItem[] }>;

function PublicProjects({ projectsQuery }: { projectsQuery: ProjectsQuery }) {
  if (projectsQuery.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (projectsQuery.isError) {
    return (
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
    );
  }
  if (projectsQuery.data && projectsQuery.data.data.length > 0) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projectsQuery.data.data.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    );
  }
  return (
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
  );
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  const n = project.nearnListing;
  const nearnHref = n?.slug ? nearnListingUrl(n.slug) : null;
  return (
    <Card className="flex flex-col border-2 border-foreground">
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="truncate">@{project.slug}</span>
          <div className="flex items-center gap-1.5">
            {n?.type && <Badge variant="outline">{n.type}</Badge>}
            {n?.status ? (
              <Badge variant="default">{n.status}</Badge>
            ) : (
              <span>{project.status}</span>
            )}
          </div>
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
          {n && <div>reward · {formatNearnReward(n)}</div>}
          {n?.totalWinnersSelected != null && n.totalWinnersSelected > 0 && (
            <div>
              {n.totalPaymentsMade ?? 0} of {n.totalWinnersSelected} paid
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
