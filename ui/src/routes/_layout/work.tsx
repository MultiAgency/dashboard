import { ArrowRightIcon, ArrowUpRightIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import {
  formatNearnReward,
  nearnDescriptionPreview,
  nearnListingHref,
  nearnSponsorUrl,
} from "@/lib/nearn";
import { projectsListQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/work")({
  head: () => ({
    meta: [{ title: "Work" }, { name: "description", content: "Active Projects." }],
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
    id?: string | null;
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
    sponsor?: { slug?: string | null } | null;
  } | null;
};

function WorkIndex() {
  const loaderData = Route.useLoaderData();
  const apiClient = useApiClient();
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
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader
        title="Our work"
        description="Active Projects. Open work, listings and applications live on NEARN."
        actions={
          nearnUrl && (
            <Button asChild variant="outline">
              <a href={nearnUrl} target="_blank" rel="noopener noreferrer">
                View on NEARN
                <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          )
        }
      />

      <PublicProjects
        projectsQuery={projectsQuery}
        nearnSponsor={settingsQuery.data?.nearnAccountId ?? null}
      />
    </div>
  );
}

type ProjectsQuery = UseQueryResult<{ data: ProjectListItem[] }>;

function PublicProjects({
  projectsQuery,
  nearnSponsor,
}: {
  projectsQuery: ProjectsQuery;
  nearnSponsor: string | null;
}) {
  if (projectsQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (projectsQuery.isError) {
    return <LoadError title="Could not load Projects" onRetry={() => projectsQuery.refetch()} />;
  }
  if (projectsQuery.data && projectsQuery.data.data.length > 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projectsQuery.data.data.map((p) => (
          <ProjectCard key={p.id} project={p} nearnSponsor={nearnSponsor} />
        ))}
      </div>
    );
  }
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderSimpleIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No public Projects yet</EmptyTitle>
        <EmptyDescription>Check back soon, or apply to contribute.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/apply">
            Apply to contribute
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function ProjectCard({
  project,
  nearnSponsor,
}: {
  project: ProjectListItem;
  nearnSponsor: string | null;
}) {
  const n = project.nearnListing;
  const nearnHref = n ? nearnListingHref(n, nearnSponsor) : null;
  const descriptionPreview = nearnDescriptionPreview(n?.description);
  const paid =
    n?.totalWinnersSelected != null && n.totalWinnersSelected > 0
      ? `${n.totalPaymentsMade ?? 0} of ${n.totalWinnersSelected}`
      : null;
  const deadline = n?.deadline ? new Date(n.deadline).toISOString().slice(0, 10) : null;
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          <span className="block truncate">@{project.slug}</span>
        </CardDescription>
        <CardTitle>
          <h2 className="break-words">{project.title}</h2>
        </CardTitle>
        <CardAction>
          <Badge variant="outline">{n?.status ?? project.status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {descriptionPreview && (
          <p className="line-clamp-3 text-xs/relaxed text-muted-foreground">{descriptionPreview}</p>
        )}
        {n && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <ListingFact label="Reward" value={formatNearnReward(n)} />
            {n.type && <ListingFact label="Type" value={n.type} />}
            {paid && <ListingFact label="Paid" value={paid} />}
            {deadline && <ListingFact label="Deadline" value={deadline} />}
          </dl>
        )}
      </CardContent>
      {nearnHref && (
        <CardFooter className="mt-auto">
          <Button asChild variant="outline" className="w-full">
            <a href={nearnHref} target="_blank" rel="noopener noreferrer">
              Open listing
              <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
            </a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ListingFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-1/3" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-8 w-full" />
      </CardFooter>
    </Card>
  );
}
