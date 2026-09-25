import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "@/components";
import { AssignmentsSection } from "@/components/admin/assignments-section";
import { InternalListingSection } from "@/components/admin/internal-listing-form";
import { ProjectBillingsSection } from "@/components/admin/project-billings";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import type { Project } from "@/components/admin/project-form";
import { ProjectForm } from "@/components/admin/project-form";
import { NearnSnapshot, projectStatusVariant } from "@/components/admin/projects-section";
import { AdminError } from "@/components/admin-error";
import { Empty as AdminEmpty } from "@/components/admin-form";
import { AdminSectionSkeleton } from "@/components/admin-section-states";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { ScrollableTabsList } from "@/components/scrollable-tabs-list";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { nearnListingHref } from "@/lib/nearn";
import {
  adminContributorsListQueryOptions,
  adminInternalListingQueryOptions,
  adminNearnListingQueryOptions,
  adminNearnSubmissionsQueryOptions,
  adminProjectBudgetQueryOptions,
  adminProjectDetailQueryOptions,
  publicSettingsQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { safeHttpHref } from "@/lib/url";

const PROJECT_TABS = ["overview", "budget", "listings", "billings", "settings"] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

export const Route = createFileRoute("/_layout/_authenticated/admin/projects/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `${params.slug} | Admin · Projects` }],
  }),
  validateSearch: z.object({
    tab: z.enum(PROJECT_TABS).optional().catch(undefined),
  }),
  loader: async ({ context, params }) => {
    const projectData = await context.queryClient
      .ensureQueryData(adminProjectDetailQueryOptions(context.apiClient, params.slug))
      .catch(() => null);
    if (!projectData) return;
    const projectId = projectData.project.id;
    await Promise.allSettled([
      context.queryClient.ensureQueryData(
        adminProjectBudgetQueryOptions(context.apiClient, projectId),
      ),
      context.queryClient.ensureQueryData(
        adminInternalListingQueryOptions(context.apiClient, projectId),
      ),
      projectData.project.nearnListingId
        ? context.queryClient.ensureQueryData(
            adminNearnSubmissionsQueryOptions(
              context.apiClient,
              projectData.project.nearnListingId,
            ),
          )
        : Promise.resolve(),
    ]);
  },
  component: AdminProjectDetail,
});

function AdminProjectDetail() {
  const { slug } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const apiClient = useApiClient();

  const projectQuery = useQuery(adminProjectDetailQueryOptions(apiClient, slug));
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const { agencyDao, isLoaded } = useMeRoles();

  const nearnSlug = projectQuery.data?.project.nearnListingId ?? null;
  const nearnListingQuery = useQuery(adminNearnListingQueryOptions(apiClient, nearnSlug ?? ""));

  if (projectQuery.isLoading) {
    return <AdminSectionSkeleton rows={4} />;
  }
  if (projectQuery.isError) {
    return <AdminError error={projectQuery.error} />;
  }
  if (!projectQuery.data) throw notFound();

  const { project, contributors: contributorsRaw } = projectQuery.data;
  const contributors = contributorsRaw ?? [];
  const nearnSponsor = settingsQuery.data?.nearnAccountId ?? null;
  const nearnUrl = nearnListingHref(nearnListingQuery.data?.listing ?? {}, nearnSponsor);
  const activeTab: ProjectTab = tab ?? "overview";
  const needsTreasury = isLoaded && !agencyDao;
  const repositoryHref = safeHttpHref(project.repository ?? "");

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link to="/admin/projects">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          All projects
        </Link>
      </Button>

      <PageHeader
        title={project.title}
        description={`@${project.slug}`}
        actions={
          <>
            <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
            <Badge variant="outline">{project.visibility}</Badge>
            {project.nearnListingId && <Badge variant="outline">NEARN-listed</Badge>}
          </>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({
            search: { tab: value === "overview" ? undefined : (value as ProjectTab) },
            replace: true,
          });
        }}
      >
        <ScrollableTabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="billings">Billings</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </ScrollableTabsList>

        <TabsContent value="overview">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Overview</h2>
                </CardTitle>
                <CardDescription>Key facts about this project.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <Fact label="Status">{project.status}</Fact>
                  <Fact label="Visibility">{project.visibility}</Fact>
                  <Fact label="Builders">{contributors.length}</Fact>
                  <Fact label="Repository" wide>
                    {repositoryHref ? (
                      <a
                        href={repositoryHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all underline-offset-2 hover:underline"
                      >
                        {project.repository}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Fact>
                  <Fact label="NEARN listing">
                    {nearnUrl ? (
                      <a
                        href={nearnUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        {project.nearnListingId}
                        <ArrowUpRightIcon aria-hidden className="text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{project.nearnListingId ?? "—"}</span>
                    )}
                  </Fact>
                </dl>
                {project.description && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Notes</span>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {project.description}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            <AssignmentsSection projectId={project.id} />
          </div>
        </TabsContent>

        <TabsContent value="budget">
          {needsTreasury ? (
            <ConnectTreasuryPrompt />
          ) : agencyDao ? (
            <ProjectBudgetPanel projectId={project.id} showAgencyBudgetLink />
          ) : null}
        </TabsContent>

        <TabsContent value="listings">
          <div className="flex flex-col gap-6">
            {project.nearnListingId && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>NEARN listing</h2>
                  </CardTitle>
                  <CardDescription>The public bounty this project tracks on NEARN.</CardDescription>
                </CardHeader>
                <CardContent>
                  <NearnSnapshot slug={project.nearnListingId} nearnSponsor={nearnSponsor} />
                </CardContent>
              </Card>
            )}
            {project.nearnListingId && <NearnSubmissionsSection slug={project.nearnListingId} />}
            {needsTreasury ? (
              <ConnectTreasuryPrompt />
            ) : agencyDao ? (
              <InternalListingSection
                projectId={project.id}
                hasNearnListing={!!project.nearnListingId}
              />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="billings">
          {needsTreasury ? (
            <ConnectTreasuryPrompt />
          ) : agencyDao ? (
            <ProjectBillingsSection projectId={project.id} contributors={contributors} />
          ) : null}
        </TabsContent>

        <TabsContent value="settings">
          <div className="flex flex-col gap-6">
            <ProjectForm
              key={`${project.id}-${project.status}-${project.visibility}`}
              mode="edit"
              publicNearnHref={nearnUrl}
              defaultValues={{
                id: project.id,
                slug: project.slug,
                title: project.title,
                description: project.description,
                repository: project.repository,
                nearnListingId: project.nearnListingId ?? "",
                status: project.status as Project["status"],
                visibility: project.visibility as Project["visibility"],
              }}
            />
            <DeleteProjectSection
              projectId={project.id}
              projectTitle={project.title}
              projectSlug={project.slug}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={wide ? "flex min-w-0 flex-col gap-1 sm:col-span-2" : "flex min-w-0 flex-col gap-1"}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

function NearnSubmissionsSection({ slug }: { slug: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(adminNearnSubmissionsQueryOptions(apiClient, slug));
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const contributorByNearAccount = new Map(
    (contributorsQuery.data?.data ?? []).map((c) => [c.nearAccount, c]),
  );
  const addContributorMutation = useMutation({
    mutationFn: (input: { name: string; nearAccount: string }) =>
      apiClient.contributors.create({ nearAccount: input.nearAccount, name: input.name }),
    onSuccess: (_data, vars) => {
      toast.success(`Added ${vars.name} as a builder`);
      void refreshAfter(queryClient, { type: "builders" });
    },
    onError: (err) => {
      toast.error(`Could not add builder: ${(err as Error).message}`);
    },
  });

  const submissions = query.data?.submissions ?? [];
  const winnerCount = submissions.filter((s) => s.isWinner).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>NEARN submissions</h2>
        </CardTitle>
        <CardDescription>
          {query.isSuccess
            ? `${submissions.length} submission${submissions.length === 1 ? "" : "s"}${
                winnerCount > 0 ? `, ${winnerCount} winner${winnerCount === 1 ? "" : "s"}` : ""
              }. Add submitters as builders to pay them.`
            : "Work submitted to the NEARN listing."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <AdminSectionSkeletonRows />
        ) : query.isError ? (
          <LoadError
            title="NEARN submissions not reachable"
            description={`Nothing found for slug “${slug}”. Check the slug or try again later.`}
            onRetry={() => query.refetch()}
          />
        ) : submissions.length === 0 ? (
          <AdminEmpty label="No submissions yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Submitter</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Ask</TableHead>
                <TableHead scope="col">Builder</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Link</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((s) => {
                const href = safeHttpHref(s.link);
                const account = s.user.publicKey;
                const adding =
                  addContributorMutation.isPending &&
                  addContributorMutation.variables?.nearAccount === s.user.publicKey;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="font-medium">
                        {s.user.name ?? s.user.username ?? s.user.id}
                      </span>
                      {(s.user.username || account) && (
                        <span className="block max-w-56 truncate text-muted-foreground">
                          {s.user.username ? `@${s.user.username}` : ""}
                          {s.user.username && account ? " · " : ""}
                          {account ?? ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.isWinner && (
                          <Badge>winner{s.winnerPosition ? ` #${s.winnerPosition}` : ""}</Badge>
                        )}
                        {s.status && <Badge variant="outline">{s.status}</Badge>}
                        {s.label && s.label !== "New" && <Badge variant="outline">{s.label}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {s.ask != null && s.token ? `${s.ask} ${s.token}` : ""}
                      {s.rewardInUSD != null && s.rewardInUSD > 0 && (
                        <span className="block">${Math.round(s.rewardInUSD)}</span>
                      )}
                      {!(s.ask != null && s.token) && !(s.rewardInUSD && s.rewardInUSD > 0) && "—"}
                    </TableCell>
                    <TableCell>
                      {s.user.publicKey &&
                        contributorsQuery.isSuccess &&
                        (contributorByNearAccount.has(s.user.publicKey) ? (
                          <Badge variant="secondary">
                            <CheckIcon data-icon="inline-start" aria-hidden />
                            {contributorByNearAccount.get(s.user.publicKey)!.name}
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={adding}
                            onClick={() =>
                              addContributorMutation.mutate({
                                name: s.user.name ?? s.user.username ?? s.user.publicKey!,
                                nearAccount: s.user.publicKey!,
                              })
                            }
                          >
                            <PlusIcon data-icon="inline-start" aria-hidden />
                            {adding ? "Adding…" : "Add builder"}
                          </Button>
                        ))}
                    </TableCell>
                    <TableCell>
                      {href && (
                        <div className="flex justify-end">
                          <Button asChild variant="ghost" size="icon-sm">
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Open submission"
                            >
                              <ArrowUpRightIcon aria-hidden />
                            </a>
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AdminSectionSkeletonRows() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function DeleteProjectSection({
  projectId,
  projectTitle,
  projectSlug,
}: {
  projectId: string;
  projectTitle: string;
  projectSlug: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.agency.projects.delete({ id: projectId }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "projectDeleted" });
      toast.success(`Project @${projectSlug} deleted`);
      navigate({ to: "/work" });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete project"),
  });

  return (
    <Card variant="destructive">
      <CardHeader>
        <CardTitle>
          <h2>Delete this project</h2>
        </CardTitle>
        <CardDescription>
          Removes the project with its builder assignments and listings. A project shared with a
          Client, or with budget entries or billings, keeps its history: archive it instead. This
          cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={deleteMutation.isPending}
        >
          <TrashIcon data-icon="inline-start" aria-hidden />
          {deleteMutation.isPending ? "Deleting…" : "Delete project"}
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete project "${projectTitle}"?`}
        description={`@${projectSlug} and its assignments and listings will be deleted. Projects with money history or shared with a Client can only be archived. This cannot be undone.`}
        confirmLabel="Delete project"
        destructive
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </Card>
  );
}
