import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { nearnListingUrl } from "@/lib/nearn";
import {
  adminContributorsListQueryOptions,
  adminTokensQueryOptions,
  publicSettingsQueryOptions,
} from "@/lib/queries";
import { trezuPaymentUrl, trezuProposalUrl } from "@/lib/trezu";

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
  component: AdminProjectDetail,
});

function AdminProjectDetail() {
  const { slug } = Route.useParams();
  const apiClient = useApiClient();

  const projectQuery = useQuery({
    queryKey: ["admin", "projects", "detail", slug],
    queryFn: () => apiClient.agency.projects.adminGet({ slug }),
    retry: false,
  });

  const projectId = projectQuery.data?.project.id;
  const budgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", projectId],
    queryFn: () => apiClient.agency.projects.getBudget({ projectId: projectId! }),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }
  if (projectQuery.isError) {
    return <AdminError error={projectQuery.error} />;
  }
  if (!projectQuery.data) throw notFound();

  const { project, contributors } = projectQuery.data;
  const nearnUrl = project.nearnListingId ? nearnListingUrl(project.nearnListingId) : null;

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

      <DeleteProjectSection
        projectId={project.id}
        projectTitle={project.title}
        projectSlug={project.slug}
      />
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
    mutationFn: () => apiClient.agency.projects.adminDelete({ id: projectId }),
    onSuccess: async () => {
      // The project (and its cascade rows) are gone — bust every query that referenced this project.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "projects"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
        queryClient.invalidateQueries({ queryKey: ["proposals", "adminList"] }),
      ]);
      toast.success(`Project @${projectSlug} deleted`);
      // Project detail is unreachable now — leave before the next adminGet 404s.
      navigate({ to: "/admin/projects" });
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
    queryFn: ({ pageParam }) => apiClient.billings.adminList({ projectId, cursor: pageParam }),
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
    mutationFn: async () => apiClient.billings.adminDelete({ id: billing.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "billings", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "projects", "budget"] }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
        queryClient.invalidateQueries({ queryKey: ["proposals", "adminList"] }),
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
      apiClient.billings.adminCreate({
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
