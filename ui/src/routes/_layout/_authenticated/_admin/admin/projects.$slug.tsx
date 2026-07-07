import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Budget,
  Button,
  Card,
  CardContent,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass, textareaClass } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { nearnListingUrl } from "@/lib/nearn";
import {
  adminContributorsListQueryKey,
  adminContributorsListQueryOptions,
  adminInternalListingQueryKey,
  adminInternalListingQueryOptions,
  adminNearnSubmissionsQueryOptions,
  adminProjectBudgetQueryKey,
  adminProjectBudgetQueryOptions,
  adminProjectDetailQueryOptions,
  adminTokensQueryOptions,
  publicSettingsQueryOptions,
} from "@/lib/queries";
import { trezuPaymentUrl, trezuProposalUrl } from "@/lib/trezu";
import { safeHttpHref } from "@/lib/url";

type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

const TERMINAL_FAIL: ReadonlySet<ProposalStatus> = new Set([
  "Rejected",
  "Removed",
  "Expired",
  "Moved",
  "Failed",
]);

function statusBadgeVariant(status: ProposalStatus): "default" | "outline" | "destructive" {
  if (status === "Approved") return "default";
  if (TERMINAL_FAIL.has(status)) return "destructive";
  return "outline";
}

export const Route = createFileRoute("/_layout/_authenticated/_admin/admin/projects/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `${params.slug} | Admin · Projects` }],
  }),
  loader: async ({ context, params }) => {
    // Warm the query cache server-side; errors non-fatal so the component owns error/not-found UI.
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

  const projectId = projectQuery.data?.project.id;
  const budgetQuery = useQuery({
    ...adminProjectBudgetQueryOptions(apiClient, projectId ?? ""),
    enabled: !!projectId,
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }
  if (projectQuery.isError) {
    return <AdminError error={projectQuery.error} />;
  }
  if (!projectQuery.data) throw notFound();

  const { project, contributors: contributorsRaw } = projectQuery.data;
  const contributors = contributorsRaw ?? [];
  const nearnUrl = project.nearnListingId ? nearnListingUrl(project.nearnListingId) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/work"
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
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Contributors</h2>
        {contributors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contributors assigned.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {contributors.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  {c.role && <div className="text-xs text-muted-foreground">{c.role}</div>}
                  {c.nearAccountId && (
                    <div className="text-xs font-mono text-muted-foreground break-all">
                      {c.nearAccountId}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Budget</h2>
        {budgetQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading budget…</p>
        ) : budgetQuery.data && budgetQuery.data.budgets.length > 0 ? (
          <div className="space-y-4">
            {budgetQuery.data.budgets.map((b) => (
              <Budget key={b.tokenId} budget={b} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No budget yet.</p>
        )}
      </section>

      {projectId && <BillingsSection projectId={projectId} contributors={contributors} />}

      {projectId && (
        <InternalListingSection projectId={projectId} hasNearnListing={!!project.nearnListingId} />
      )}

      {nearnUrl && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">NEARN listing</h2>
          <Button asChild variant="outline" size="sm">
            <a href={nearnUrl} target="_blank" rel="noopener noreferrer">
              view on nearn <ArrowUpRight className="ml-1 size-3" />
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
  // Bridge: submission.user.publicKey ↔ contributor.nearAccountId — see project memory.
  const contributorByNearAccount = new Map(
    (contributorsQuery.data?.data ?? [])
      .filter((c): c is typeof c & { nearAccountId: string } => !!c.nearAccountId)
      .map((c) => [c.nearAccountId, c]),
  );
  const addContributorMutation = useMutation({
    mutationFn: (input: { name: string; nearAccountId: string }) =>
      apiClient.contributors.create(input),
    onSuccess: (_data, vars) => {
      toast.success(`Added ${vars.name} as a contributor`);
      queryClient.invalidateQueries({ queryKey: adminContributorsListQueryKey });
    },
    onError: (err) => {
      toast.error(`Could not add contributor: ${(err as Error).message}`);
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
                      addContributorMutation.variables?.nearAccountId === s.user.publicKey
                    }
                    onClick={() =>
                      addContributorMutation.mutate({
                        name: s.user.name ?? s.user.username ?? s.user.publicKey!,
                        nearAccountId: s.user.publicKey!,
                      })
                    }
                  >
                    {addContributorMutation.isPending &&
                    addContributorMutation.variables?.nearAccountId === s.user.publicKey
                      ? "adding…"
                      : "+ add contributor"}
                  </Button>
                ))}
              {s.isWinner && (
                <Badge variant="default">
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
                    open <ArrowUpRight className="inline size-3" />
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
      // The project (and its cascade rows) are gone — bust every query that referenced this project.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "projects"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
        queryClient.invalidateQueries({ queryKey: ["proposals", "list"] }),
      ]);
      toast.success(`Project @${projectSlug} deleted`);
      // Project detail is unreachable now — leave before the next get 404s.
      navigate({ to: "/work" });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete project"),
  });

  return (
    <section className="space-y-3 pt-4 border-t border-destructive/30">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Danger zone</h2>
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Delete this project</AlertTitle>
        <AlertDescription>
          Removes the project and cascades all local billings, budgets, contributor assignments, and
          listings. On-chain Sputnik proposals are unaffected — they survive via their proposalIds.
          This cannot be undone.
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
        description={`@${projectSlug} and every local billing / budget / listing / assignment scoped to it will be deleted. On-chain proposals are unaffected. This cannot be undone.`}
        confirmLabel="delete project"
        destructive
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </section>
  );
}

type ProjectContributor = {
  id: string;
  name: string;
  nearAccountId: string | null;
  role: string | null;
};

function BillingsSection({
  projectId,
  contributors,
}: {
  projectId: string;
  contributors: ProjectContributor[];
}) {
  const apiClient = useApiClient();
  const [creating, setCreating] = useState(false);

  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const orgAccountId = settingsQuery.data?.orgAccountId ?? null;

  const billingsQuery = useInfiniteQuery({
    queryKey: ["admin", "billings", "list", projectId],
    queryFn: ({ pageParam }) => apiClient.billings.list({ projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const billings = billingsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Billings</h2>
        <Button
          onClick={() => setCreating((v) => !v)}
          variant={creating ? "outline" : "default"}
          size="sm"
        >
          {creating ? "cancel" : "+ billing"}
        </Button>
      </div>

      {creating && (
        <BillingCreateForm
          projectId={projectId}
          contributors={contributors}
          orgAccountId={orgAccountId}
          onDone={() => setCreating(false)}
        />
      )}

      {billingsQuery.isLoading ? (
        <Loading label="Loading billings..." />
      ) : billings.length > 0 ? (
        <>
          <div className="space-y-2">
            {billings.map((b) => (
              <BillingRow key={b.id} billing={b} orgAccountId={orgAccountId} />
            ))}
          </div>
          {billingsQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => billingsQuery.fetchNextPage()}
                disabled={billingsQuery.isFetchingNextPage}
              >
                {billingsQuery.isFetchingNextPage ? "loading..." : "load more"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty label="No billings recorded for this project." />
      )}
    </section>
  );
}

function BillingRow({
  billing,
  orgAccountId,
}: {
  billing: {
    id: string;
    proposalId: string;
    status: ProposalStatus;
    tokenId: string;
    amount: string;
    note: string | null;
    createdAt: Date;
  };
  orgAccountId: string | null;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => apiClient.billings.delete({ id: billing.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
        queryClient.invalidateQueries({ queryKey: ["proposals", "list"] }),
      ]);
      toast.success(`Billing for proposal #${billing.proposalId} deleted`);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete billing"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(billing.status)}>{billing.status}</Badge>
          {orgAccountId && (
            <a
              href={trezuProposalUrl(orgAccountId, billing.proposalId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              proposal #{billing.proposalId} ↗
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-xs"
            onClick={() => setConfirmOpen(true)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "deleting..." : "delete"}
          </Button>
        </div>
        <div className="font-mono text-sm break-all">
          {formatTokenAmount(billing.amount, billing.tokenId)}
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(billing.createdAt).toISOString().slice(0, 10)}
        </div>
        {billing.note && <div className="text-xs text-muted-foreground italic">{billing.note}</div>}
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete billing for proposal #${billing.proposalId}?`}
        description="You can re-record it afterwards. Chain status remains the source of truth."
        confirmLabel="delete"
        destructive
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </Card>
  );
}

function BillingCreateForm({
  projectId,
  contributors,
  orgAccountId,
  onDone,
}: {
  projectId: string;
  contributors: ProjectContributor[];
  orgAccountId: string | null;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [proposalId, setProposalId] = useState("");
  const [contributorIdOverride, setContributorIdOverride] = useState("");
  const [note, setNote] = useState("");

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const allContributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const onboardingById = new Map(
    (allContributorsQuery.data?.data ?? []).map((c) => [c.id, c.onboardingStatus]),
  );

  const payableContributors = contributors.filter((c) => c.nearAccountId);
  const [prefillContributorId, setPrefillContributorId] = useState<string>(
    () => payableContributors[0]?.id ?? "",
  );
  const [prefillTokenId, setPrefillTokenId] = useState<string>("");

  const prefillContributor = payableContributors.find((c) => c.id === prefillContributorId);
  const prefillToken = tokens.find((t) => t.tokenId === prefillTokenId);

  const targetContributorId = contributorIdOverride.trim() || prefillContributorId;
  const targetOnboardingStatus = targetContributorId
    ? onboardingById.get(targetContributorId)
    : undefined;
  const showOnboardingWarning =
    targetOnboardingStatus !== undefined && targetOnboardingStatus !== "complete";
  const targetContributorName =
    contributors.find((c) => c.id === targetContributorId)?.name ??
    allContributorsQuery.data?.data.find((c) => c.id === targetContributorId)?.name ??
    "this contributor";

  const trezuPrefillUrl =
    orgAccountId &&
    trezuPaymentUrl(orgAccountId, {
      receiverAddress: prefillContributor?.nearAccountId ?? undefined,
      token: prefillToken
        ? {
            tokenId: prefillToken.tokenId,
            symbol: prefillToken.symbol,
            network: prefillToken.network,
            decimals: prefillToken.decimals,
          }
        : undefined,
    });

  const createMutation = useMutation({
    mutationFn: async () =>
      apiClient.billings.create({
        projectId,
        proposalId: proposalId.trim(),
        contributorId: contributorIdOverride || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
      ]);
      toast.success("Billing recorded");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to record billing"),
  });

  const isPending = createMutation.isPending;
  const canSubmit = proposalId.trim().length > 0 && !isPending;

  return (
    <Card>
      <CardContent className="p-4 grid gap-3">
        {orgAccountId && payableContributors.length > 0 && (
          <div className="grid gap-3 rounded-md border border-dashed p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Need to create the proposal first?
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="recipient" htmlFor="prefill-contributor">
                <select
                  id="prefill-contributor"
                  value={prefillContributorId}
                  onChange={(e) => setPrefillContributorId(e.target.value)}
                  className={selectClass}
                >
                  {payableContributors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.nearAccountId})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="token" htmlFor="prefill-token">
                <select
                  id="prefill-token"
                  value={prefillTokenId}
                  onChange={(e) => setPrefillTokenId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— pick in Trezu —</option>
                  {tokens.map((t) => (
                    <option key={t.tokenId} value={t.tokenId}>
                      {t.symbol} — {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button asChild variant="outline" size="sm" disabled={!trezuPrefillUrl}>
              <a
                href={trezuPrefillUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center"
              >
                open prefilled in trezu <ArrowUpRight className="ml-1 size-3" />
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens Trezu with recipient and token prefilled. Set the amount in Trezu, submit the
              proposal, then paste the resulting proposal id below.
            </p>
          </div>
        )}
        <Field label="proposal id" htmlFor="new-bill-proposal">
          <Input
            id="new-bill-proposal"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
            placeholder="e.g. 42"
            disabled={isPending}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Paste the Sputnik DAO Transfer proposal id (from Trezu, or NEARN's "Pay with NEAR
          Treasury"). Token, amount, and recipient are read from chain. Non-Transfer proposals are
          rejected.
        </p>
        <Field
          label="contributor override (optional, defaults to recipient lookup)"
          htmlFor="new-bill-contributor"
        >
          <Input
            id="new-bill-contributor"
            value={contributorIdOverride}
            onChange={(e) => setContributorIdOverride(e.target.value)}
            placeholder="contributor id (rare; leave blank to auto-detect)"
            disabled={isPending}
          />
        </Field>
        <Field label="note (optional)" htmlFor="new-bill-note">
          <textarea
            id="new-bill-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            disabled={isPending}
            className={textareaClass}
          />
        </Field>
        {showOnboardingWarning && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>
              Onboarding {targetOnboardingStatus} for {targetContributorName}
            </AlertTitle>
            <AlertDescription>
              Confirm signed services agreement and tax form (W-9 or W-8BEN) are on file before
              recording a payout.{" "}
              <Link
                to="/docs/$slug"
                params={{ slug: "contributors" }}
                className="underline underline-offset-2"
              >
                onboarding flow ↗
              </Link>
            </AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} size="sm">
            {isPending ? "recording..." : "record billing"}
          </Button>
          <Button onClick={onDone} variant="outline" disabled={isPending} size="sm">
            cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type InternalListing = NonNullable<
  Awaited<ReturnType<ApiClient["agency"]["listings"]["get"]>>["listing"]
>;

const internalListingFormSchema = z.object({
  title: z.string().trim().min(1, "required").max(200),
  type: z.enum(["Bounty", "Project", "Sponsorship"]),
  token: z.string().trim().min(1, "required"),
  rewardAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'decimal amount e.g. "100" or "100.5"')
    .max(80)
    .refine((s) => Number.parseFloat(s) > 0, "must be greater than 0"),
  description: z.string().trim().max(16000),
  deadline: z.string().trim(),
  isPublished: z.boolean(),
  isArchived: z.boolean(),
  isWinnersAnnounced: z.boolean(),
});

type InternalListingFormValues = z.infer<typeof internalListingFormSchema>;

function lifecycleLabel(row: InternalListing): string {
  if (row.isArchived) return "archived";
  if (row.isWinnersAnnounced) return "winners announced";
  if (row.isPublished) return "published";
  return "draft";
}

function fieldErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "invalid";
  }
  return "invalid";
}

function InternalListingSection({
  projectId,
  hasNearnListing,
}: {
  projectId: string;
  hasNearnListing: boolean;
}) {
  const apiClient = useApiClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const listingQuery = useQuery(adminInternalListingQueryOptions(apiClient, projectId));

  const row = listingQuery.data?.listing ?? null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Internal listing</h2>
        {!editing && row && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} variant="outline" size="sm">
              edit
            </Button>
            <Button onClick={() => setConfirmDelete(true)} variant="ghost" size="sm">
              delete
            </Button>
          </div>
        )}
        {!editing && !row && !listingQuery.isLoading && (
          <Button onClick={() => setEditing(true)} variant="default" size="sm">
            + internal listing
          </Button>
        )}
      </div>

      {hasNearnListing && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>NEARN listing takes priority for rollups</AlertTitle>
          <AlertDescription>
            This project has a NEARN listing attached. The internal listing is dormant — rollup math
            uses NEARN. To activate the internal listing, detach NEARN from the project's edit form.
          </AlertDescription>
        </Alert>
      )}

      {listingQuery.isLoading ? (
        <Loading label="Loading internal listing..." />
      ) : editing ? (
        <InternalListingForm
          projectId={projectId}
          existing={row}
          onDone={() => setEditing(false)}
        />
      ) : row ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{row.type ?? "—"}</Badge>
              <Badge variant={row.isPublished && !row.isArchived ? "default" : "outline"}>
                {lifecycleLabel(row)}
              </Badge>
            </div>
            <div className="text-sm font-medium">{row.title ?? "(untitled)"}</div>
            <div className="font-mono text-sm">
              {row.rewardAmount ?? "0"} {row.token ?? ""}
            </div>
            {row.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.description}</p>
            )}
            {row.deadline && (
              <div className="text-xs text-muted-foreground">
                deadline: {new Date(row.deadline).toISOString().slice(0, 10)}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Empty label="No internal listing. Use this when no NEARN listing exists — notably on testnet, where NEARN is unavailable." />
      )}

      {row && (
        <InternalListingDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          projectId={projectId}
          listingTitle={row.title ?? "(untitled)"}
        />
      )}
    </section>
  );
}

function InternalListingForm({
  projectId,
  existing,
  onDone,
}: {
  projectId: string;
  existing: InternalListing | null;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const isEdit = existing !== null;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminInternalListingQueryKey }),
      queryClient.invalidateQueries({ queryKey: adminProjectBudgetQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
    ]);
  };

  const submitMutation = useMutation({
    mutationFn: async (values: InternalListingFormValues) => {
      const deadlineDate = values.deadline ? new Date(values.deadline) : null;
      const payload = {
        projectId,
        title: values.title.trim(),
        type: values.type,
        token: values.token,
        rewardAmount: values.rewardAmount.trim(),
        description: values.description.trim() || undefined,
        deadline: deadlineDate,
        isPublished: values.isPublished,
        isArchived: values.isArchived,
        isWinnersAnnounced: values.isWinnersAnnounced,
      };
      if (isEdit) {
        return apiClient.agency.listings.update(payload);
      }
      return apiClient.agency.listings.create(payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(isEdit ? "Internal listing updated" : "Internal listing created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save internal listing"),
  });

  const form = useForm({
    defaultValues: {
      title: existing?.title ?? "",
      type: internalListingFormSchema.shape.type.safeParse(existing?.type).data ?? "Bounty",
      token: existing?.token ?? "NEAR",
      rewardAmount: existing?.rewardAmount ?? "",
      description: existing?.description ?? "",
      deadline: existing?.deadline ? new Date(existing.deadline).toISOString().slice(0, 10) : "",
      isPublished: existing?.isPublished ?? true,
      isArchived: existing?.isArchived ?? false,
      isWinnersAnnounced: existing?.isWinnersAnnounced ?? false,
    } as InternalListingFormValues,
    validators: { onChange: internalListingFormSchema, onSubmit: internalListingFormSchema },
    onSubmit: async ({ value }) => {
      await submitMutation.mutateAsync(value);
    },
  });

  const isPending = submitMutation.isPending;

  return (
    <Card>
      <CardContent className="p-4 grid gap-3">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await form.validateAllFields("submit");
            if (form.state.canSubmit) form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => {
              const err = field.state.meta.errors[0];
              return (
                <Field label="title" htmlFor={field.name}>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g. Build the agency portal"
                    disabled={isPending}
                    aria-invalid={err ? true : undefined}
                  />
                  {err && <p className="text-xs text-destructive">{fieldErr(err)}</p>}
                </Field>
              );
            }}
          </form.Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <form.Field name="type">
              {(field) => (
                <Field label="type" htmlFor={field.name}>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      const parsed = internalListingFormSchema.shape.type.safeParse(e.target.value);
                      if (parsed.success) field.handleChange(parsed.data);
                    }}
                    disabled={isPending}
                    className={selectClass}
                  >
                    <option value="Bounty">Bounty</option>
                    <option value="Project">Project</option>
                    <option value="Sponsorship">Sponsorship</option>
                  </select>
                </Field>
              )}
            </form.Field>

            <form.Field name="token">
              {(field) => (
                <Field label="token" htmlFor={field.name}>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={isPending || tokensQuery.isLoading}
                    className={selectClass}
                  >
                    {tokens.length === 0 && <option value="NEAR">NEAR</option>}
                    {tokens.map((t) => (
                      <option key={t.tokenId} value={t.symbol}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </form.Field>

            <form.Field name="rewardAmount">
              {(field) => {
                const err = field.state.meta.errors[0];
                return (
                  <Field label="reward amount" htmlFor={field.name}>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="100"
                      inputMode="decimal"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                    />
                    {err && <p className="text-xs text-destructive">{fieldErr(err)}</p>}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <form.Field name="description">
            {(field) => (
              <Field label="description (optional)" htmlFor={field.name}>
                <textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                  disabled={isPending}
                  className={textareaClass}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="deadline">
            {(field) => (
              <Field label="deadline (optional, YYYY-MM-DD)" htmlFor={field.name}>
                <Input
                  id={field.name}
                  name={field.name}
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            )}
          </form.Field>

          <div className="grid gap-2 sm:grid-cols-3">
            <form.Field name="isPublished">
              {(field) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    disabled={isPending}
                  />
                  published
                </label>
              )}
            </form.Field>
            <form.Field name="isWinnersAnnounced">
              {(field) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    disabled={isPending}
                  />
                  winners announced
                </label>
              )}
            </form.Field>
            <form.Field name="isArchived">
              {(field) => (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    disabled={isPending}
                  />
                  archived
                </label>
              )}
            </form.Field>
          </div>

          <p className="text-xs text-muted-foreground">
            Lifecycle drives the rollup column the listing contributes to: <code>published</code> +
            no winners → <em>allocated</em>; <code>winners announced</code> → <em>committed</em>{" "}
            (until a billing exists); <code>archived</code> or unpublished → excluded.
          </p>

          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} size="sm">
              {isPending ? "saving..." : isEdit ? "save changes" : "create listing"}
            </Button>
            <Button onClick={onDone} variant="outline" disabled={isPending} size="sm" type="button">
              cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InternalListingDeleteDialog({
  open,
  onOpenChange,
  projectId,
  listingTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  listingTitle: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.agency.listings.delete({ projectId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminInternalListingQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminProjectBudgetQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
      ]);
      toast.success("Internal listing deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete internal listing"),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete internal listing "${listingTitle}"?`}
      description="The listing's contribution to allocated/committed rollup columns disappears immediately. This cannot be undone."
      confirmLabel="delete listing"
      destructive
      onConfirm={async () => {
        await deleteMutation.mutateAsync();
      }}
    />
  );
}
