import { ArrowUpRightIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle, Badge, Button } from "@/components";
import { AssignmentsSection } from "@/components/admin/assignments-section";
import { InternalListingSection } from "@/components/admin/internal-listing-form";
import { ProjectBillingsSection } from "@/components/admin/project-billings";
import { ProjectBudgetPanel } from "@/components/admin/project-budget-panel";
import { AdminError } from "@/components/admin-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
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

export const Route = createFileRoute("/_layout/_authenticated/admin/projects/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `${params.slug} | Admin · Projects` }],
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
  const apiClient = useApiClient();

  const projectQuery = useQuery(adminProjectDetailQueryOptions(apiClient, slug));
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const { agencyDao, isLoaded } = useMeRoles();

  const projectId = projectQuery.data?.project.id;
  const nearnSlug = projectQuery.data?.project.nearnListingId ?? null;
  const nearnListingQuery = useQuery(adminNearnListingQueryOptions(apiClient, nearnSlug ?? ""));

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }
  if (projectQuery.isError) {
    return <AdminError error={projectQuery.error} />;
  }
  if (!projectQuery.data) throw notFound();

  const { project, contributors: contributorsRaw } = projectQuery.data;
  const contributors = contributorsRaw ?? [];
  const nearnUrl = nearnListingHref(
    nearnListingQuery.data?.listing ?? {},
    settingsQuery.data?.nearnAccountId ?? null,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/projects"
          className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← all projects
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={project.status === "active" ? "default" : "outline"}>
            {project.status}
          </Badge>
          <Badge variant="outline">{project.visibility}</Badge>
          {project.nearnListingId && <Badge variant="outline">NEARN-listed</Badge>}
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{project.title}</h1>
        <div className="text-xs font-mono text-muted-foreground">@{project.slug}</div>
      </header>

      {project.description && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Notes</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{project.description}</p>
        </section>
      )}

      <section className="space-y-3">
        <AssignmentsSection projectId={projectId!} />
      </section>

      {projectId && isLoaded && !agencyDao && <ConnectTreasuryPrompt />}

      {projectId && agencyDao && <ProjectBudgetPanel projectId={projectId} showAgencyBudgetLink />}

      {projectId && agencyDao && (
        <ProjectBillingsSection projectId={projectId} contributors={contributors} />
      )}

      {projectId && agencyDao && (
        <InternalListingSection projectId={projectId} hasNearnListing={!!project.nearnListingId} />
      )}

      {nearnUrl && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">NEARN listing</h2>
          <Button asChild variant="outline" size="sm">
            <a href={nearnUrl} target="_blank" rel="noopener noreferrer">
              view on nearn <ArrowUpRightIcon className="ml-1 size-3" />
            </a>
          </Button>
        </section>
      )}

      {project.nearnListingId && <NearnSubmissionsSection slug={project.nearnListingId} />}

      <DeleteProjectSection
        projectId={project.id}
        projectTitle={project.title}
        projectSlug={project.slug}
      />
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

  if (query.isLoading) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">NEARN submissions</h2>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">NEARN submissions</h2>
        <div className="rounded-sm border border-dashed border-destructive/60 p-3 text-xs text-destructive">
          NEARN submissions not reachable for slug "{slug}". Check the slug or try later.
        </div>
      </section>
    );
  }
  const submissions = query.data?.submissions ?? [];
  const winnerCount = submissions.filter((s) => s.isWinner).length;

  return (
    <section className="space-y-2">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
        NEARN submissions ({submissions.length}
        {winnerCount > 0 ? ` · ${winnerCount} winner${winnerCount === 1 ? "" : "s"}` : ""})
      </h2>
      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No submissions yet.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {submissions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-muted/10 px-3 py-2"
            >
              <span className="font-medium">{s.user.name ?? s.user.username ?? s.user.id}</span>
              {s.user.username && (
                <span className="font-mono text-muted-foreground">@{s.user.username}</span>
              )}
              {s.user.publicKey && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {s.user.publicKey}
                </span>
              )}
              {s.user.publicKey &&
                contributorsQuery.isSuccess &&
                (contributorByNearAccount.has(s.user.publicKey) ? (
                  <Badge variant="secondary">
                    ✓ {contributorByNearAccount.get(s.user.publicKey)!.name}
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      addContributorMutation.isPending &&
                      addContributorMutation.variables?.nearAccount === s.user.publicKey
                    }
                    onClick={() =>
                      addContributorMutation.mutate({
                        name: s.user.name ?? s.user.username ?? s.user.publicKey!,
                        nearAccount: s.user.publicKey!,
                      })
                    }
                  >
                    {addContributorMutation.isPending &&
                    addContributorMutation.variables?.nearAccount === s.user.publicKey
                      ? "adding…"
                      : "+ add builder"}
                  </Button>
                ))}
              {s.isWinner && (
                <Badge variant="outline">
                  winner{s.winnerPosition ? ` #${s.winnerPosition}` : ""}
                </Badge>
              )}
              {s.status && <Badge variant="outline">{s.status}</Badge>}
              {s.label && s.label !== "New" && <Badge variant="outline">{s.label}</Badge>}
              {s.ask != null && s.token && (
                <span className="font-mono text-muted-foreground">
                  ask: {s.ask} {s.token}
                </span>
              )}
              {s.rewardInUSD != null && s.rewardInUSD > 0 && (
                <span className="font-mono text-muted-foreground">
                  ${Math.round(s.rewardInUSD)}
                </span>
              )}
              {(() => {
                const href = safeHttpHref(s.link);
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    open <ArrowUpRightIcon className="inline size-3" />
                  </a>
                ) : null;
              })()}
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <section className="space-y-3 pt-4 border-t border-destructive/30">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Danger zone</h2>
      <Alert variant="destructive">
        <WarningIcon className="size-4" />
        <AlertTitle>Delete this project</AlertTitle>
        <AlertDescription>
          Removes the project with its builder assignments and listings. A project that is shared
          with a Client or has budget entries or billings keeps its history: set its status to
          archived instead. This cannot be undone.
        </AlertDescription>
      </Alert>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={deleteMutation.isPending}
      >
        {deleteMutation.isPending ? "deleting..." : "delete project"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete project "${projectTitle}"?`}
        description={`@${projectSlug} and its assignments and listings will be deleted. Projects with money history or shared with a Client can only be archived. This cannot be undone.`}
        confirmLabel="delete project"
        destructive
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </section>
  );
}
