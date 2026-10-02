import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
} from "@/components";
import { useApiClient } from "@/lib/api";
import { formatNearnReward, nearnListingHref } from "@/lib/nearn";
import { publicProjectQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/work/$slug")({
  loader: async ({ context, params }) => {
    const project = await context.queryClient
      .ensureQueryData(publicProjectQueryOptions(context.apiClient, params.slug))
      .catch(() => null);
    if (!project) throw notFound();
    return { project };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.project.project.title ?? "Project" },
      {
        name: "description",
        content: loaderData?.project.description ?? "A project MultiAgency is building.",
      },
    ],
  }),
  component: PublicProjectPage,
});

function PublicProjectPage() {
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const apiClient = useApiClient();
  const projectQuery = useQuery({
    ...publicProjectQueryOptions(apiClient, slug),
    initialData: loaderData.project,
  });
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));

  if (projectQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!projectQuery.data) throw notFound();

  const { project, description, showTeam, builders } = projectQuery.data;
  const listing = project.nearnListing;
  const bountyHref = listing
    ? nearnListingHref(listing, settingsQuery.data?.nearnAccountId ?? null)
    : null;

  return (
    <div className="flex animate-fade-in flex-col gap-6">
      <Button asChild size="sm" variant="ghost" className="w-fit">
        <Link to="/work">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          Our work
        </Link>
      </Button>
      <PageHeader
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>@{project.slug}</span>
            <Badge variant="outline">{project.status}</Badge>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {project.repository && (
              <Button asChild variant="outline">
                <a href={project.repository} target="_blank" rel="noopener noreferrer">
                  Repository
                  <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                </a>
              </Button>
            )}
            {bountyHref && (
              <Button asChild variant="outline">
                <a href={bountyHref} target="_blank" rel="noopener noreferrer">
                  Open bounty
                  <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                </a>
              </Button>
            )}
          </div>
        }
      />

      {description && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>About</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{description}</p>
          </CardContent>
        </Card>
      )}

      {showTeam && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Team</h2>
            </CardTitle>
            <CardDescription>The builders working on this Project.</CardDescription>
          </CardHeader>
          <CardContent>
            {builders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No builders assigned yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {builders.map((b) => (
                  <li key={b.name} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{b.name}</span>
                    {b.role && <span className="text-muted-foreground">{b.role}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {listing && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Open bounty</h2>
            </CardTitle>
            <CardDescription>{formatNearnReward(listing)}</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Work with us</h2>
          </CardTitle>
          <CardDescription>Want something like this built, or want to build it?</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/contact">
              Hire us
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/apply">Apply to contribute</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
