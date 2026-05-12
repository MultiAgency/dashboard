import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Budget, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass, textareaClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { nearnListingUrl } from "@/lib/nearn";
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

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin/projects/$slug")({
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
    queryFn: () => apiClient.projects.adminGet({ slug }),
    retry: false,
  });

  const projectId = projectQuery.data?.project.id;
  const budgetQuery = useQuery({
    queryKey: ["admin", "projects", "budget", projectId],
    queryFn: () => apiClient.projects.getBudget({ projectId: projectId! }),
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
          <p className="text-sm text-muted-foreground">No allocations yet.</p>
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
    </div>
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

  const settingsQuery = useQuery({
    queryKey: ["settings", "adminGet"],
    queryFn: () => apiClient.settings.adminGet(),
  });
  const daoAccountId = settingsQuery.data?.settings.daoAccountId ?? null;

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
          daoAccountId={daoAccountId}
          onDone={() => setCreating(false)}
        />
      )}

      {billingsQuery.isLoading ? (
        <Loading label="Loading billings..." />
      ) : billings.length > 0 ? (
        <>
          <div className="space-y-2">
            {billings.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadgeVariant(b.status as ProposalStatus)}>
                      {b.status}
                    </Badge>
                    {daoAccountId && (
                      <a
                        href={trezuProposalUrl(daoAccountId, b.proposalId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
                      >
                        proposal #{b.proposalId} ↗
                      </a>
                    )}
                  </div>
                  <div className="font-mono text-sm break-all">
                    {formatTokenAmount(b.amount, b.tokenId)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(b.createdAt).toISOString().slice(0, 10)}
                  </div>
                  {b.note && <div className="text-xs text-muted-foreground italic">{b.note}</div>}
                </CardContent>
              </Card>
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

function BillingCreateForm({
  projectId,
  contributors,
  daoAccountId,
  onDone,
}: {
  projectId: string;
  contributors: ProjectContributor[];
  daoAccountId: string | null;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [proposalId, setProposalId] = useState("");
  const [contributorIdOverride, setContributorIdOverride] = useState("");
  const [note, setNote] = useState("");

  const tokensQuery = useQuery({
    queryKey: ["admin", "tokens"],
    queryFn: () => apiClient.tokens.list(),
  });
  const tokens = tokensQuery.data?.tokens ?? [];

  const payableContributors = contributors.filter((c) => c.nearAccountId);
  const [prefillContributorId, setPrefillContributorId] = useState<string>(
    () => payableContributors[0]?.id ?? "",
  );
  const [prefillTokenId, setPrefillTokenId] = useState<string>("");

  const prefillContributor = payableContributors.find((c) => c.id === prefillContributorId);
  const prefillToken = tokens.find((t) => t.tokenId === prefillTokenId);

  const trezuPrefillUrl =
    daoAccountId &&
    trezuPaymentUrl(daoAccountId, {
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
        {daoAccountId && payableContributors.length > 0 && (
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
