import { ArrowRightIcon, ArrowUpRightIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Skeleton,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import { formatNearnReward, nearnDescriptionPreview, nearnListingHref } from "@/lib/nearn";
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

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <PageHeader title="Our work" description="Projects we are building now." />

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
      <div className="flex flex-col gap-2.5" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (projectsQuery.isError) {
    return <LoadError title="Could not load Projects" onRetry={() => projectsQuery.refetch()} />;
  }
  if (projectsQuery.data && projectsQuery.data.data.length > 0) {
    return (
      <ItemGroup>
        {projectsQuery.data.data.map((p) => (
          <ProjectRow key={p.id} project={p} nearnSponsor={nearnSponsor} />
        ))}
      </ItemGroup>
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

function ProjectRow({
  project,
  nearnSponsor,
}: {
  project: ProjectListItem;
  nearnSponsor: string | null;
}) {
  const n = project.nearnListing;
  const bountyHref = n ? nearnListingHref(n, nearnSponsor) : null;
  const descriptionPreview = nearnDescriptionPreview(n?.description);
  const deadline = n?.deadline ? new Date(n.deadline).toISOString().slice(0, 10) : null;
  const facts = [
    `@${project.slug}`,
    n ? formatNearnReward(n) : null,
    deadline ? `Due ${deadline}` : null,
  ].filter((f): f is string => !!f);
  return (
    <li>
      <Item variant="outline" size="sm">
        <ItemContent className="min-w-0">
          <ItemTitle className="break-words">
            <h2>{project.title}</h2>
          </ItemTitle>
          <ItemDescription className="truncate">{facts.join(" · ")}</ItemDescription>
          {descriptionPreview && (
            <p className="line-clamp-2 text-xs/relaxed text-muted-foreground">
              {descriptionPreview}
            </p>
          )}
        </ItemContent>
        <ItemActions>
          <Badge variant="outline">{n?.status ?? project.status}</Badge>
          {bountyHref && (
            <Button asChild size="sm" variant="outline">
              <a href={bountyHref} target="_blank" rel="noopener noreferrer">
                Open bounty
                <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
              </a>
            </Button>
          )}
        </ItemActions>
      </Item>
    </li>
  );
}
