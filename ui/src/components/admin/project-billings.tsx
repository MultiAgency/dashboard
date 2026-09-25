import { ArrowUpRightIcon, WarningIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass, textareaClass } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import {
  adminBillingsQueryKey,
  adminContributorsListQueryOptions,
  adminTokensQueryOptions,
  refreshAfter,
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

export type ProjectContributor = {
  nearAccount: string;
  name: string;
  role: string | null;
};

export function ProjectBillingsSection({
  projectId,
  contributors,
}: {
  projectId: string;
  contributors: ProjectContributor[];
}) {
  const apiClient = useApiClient();
  const [creating, setCreating] = useState(false);

  const { agencyDao: orgAccountId } = useMeRoles();

  const billingsQuery = useInfiniteQuery({
    queryKey: adminBillingsQueryKey({ projectId }),
    queryFn: ({ pageParam }) => apiClient.billings.list({ projectId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const billings = billingsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Billings</h2>
        {orgAccountId && (
          <Button
            onClick={() => setCreating((v) => !v)}
            variant={creating ? "outline" : "default"}
            size="sm"
          >
            {creating ? "cancel" : "+ billing"}
          </Button>
        )}
      </div>

      {creating && (
        <BillingCreateForm
          projectId={projectId}
          contributors={contributors}
          orgAccountId={orgAccountId}
          onDone={() => setCreating(false)}
        />
      )}

      {billingsQuery.isError ? (
        <AdminError error={billingsQuery.error} />
      ) : billingsQuery.isLoading ? (
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
    payingDaoAccountId: string;
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
      await refreshAfter(queryClient, { type: "billings" });
      toast.success(`Billing for proposal #${billing.proposalId} deleted`);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete billing"),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const ownBilling = orgAccountId !== null && billing.payingDaoAccountId === orgAccountId;

  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusBadgeVariant(billing.status)}>{billing.status}</Badge>
          {billing.payingDaoAccountId && (
            <a
              href={trezuProposalUrl(billing.payingDaoAccountId, billing.proposalId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
            >
              proposal #{billing.proposalId} <ArrowUpRightIcon aria-hidden className="inline" />
            </a>
          )}
          {!ownBilling && (
            <span className="text-xs font-mono text-muted-foreground break-all">
              paid by {billing.payingDaoAccountId}
            </span>
          )}
          {ownBilling && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "deleting..." : "delete"}
            </Button>
          )}
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
  const [nearAccountOverride, setNearAccountOverride] = useState("");
  const [note, setNote] = useState("");

  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const allContributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));

  const payableContributors = contributors.filter((c) => c.nearAccount);
  const [prefillNearAccount, setPrefillNearAccount] = useState<string>(
    () => payableContributors[0]?.nearAccount ?? "",
  );
  const [prefillTokenId, setPrefillTokenId] = useState<string>("");

  const prefillContributor = payableContributors.find((c) => c.nearAccount === prefillNearAccount);
  const prefillToken = tokens.find((t) => t.tokenId === prefillTokenId);

  const targetNearAccount = nearAccountOverride.trim() || prefillNearAccount;
  const targetContributor = allContributorsQuery.data?.data.find(
    (c) => c.nearAccount === targetNearAccount,
  );
  const showBuilderWarning = !!targetNearAccount && targetContributor?.registered !== true;
  const targetContributorName =
    contributors.find((c) => c.nearAccount === targetNearAccount)?.name ??
    targetContributor?.name ??
    targetNearAccount ??
    "this builder";

  const trezuPrefillUrl =
    orgAccountId &&
    trezuPaymentUrl(orgAccountId, {
      receiverAddress: prefillContributor?.nearAccount ?? undefined,
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
        nearAccount: nearAccountOverride || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "billings" });
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
                  value={prefillNearAccount}
                  onChange={(e) => setPrefillNearAccount(e.target.value)}
                  className={selectClass}
                >
                  {payableContributors.map((c) => (
                    <option key={c.nearAccount} value={c.nearAccount}>
                      {c.name} ({c.nearAccount})
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
                open prefilled in trezu <ArrowUpRightIcon className="ml-1 size-3" />
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
          label="builder override (optional, defaults to recipient lookup)"
          htmlFor="new-bill-contributor"
        >
          <Input
            id="new-bill-contributor"
            value={nearAccountOverride}
            onChange={(e) => setNearAccountOverride(e.target.value)}
            placeholder="near account (rare; leave blank to auto-detect)"
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
        {showBuilderWarning && (
          <Alert>
            <WarningIcon />
            <AlertTitle>Not registered as a builder: {targetContributorName}</AlertTitle>
            <AlertDescription>
              Convert the contributor application to a builder profile, or add them as a builder,
              before recording a payout.{" "}
              <Link
                to="/docs/$slug"
                params={{ slug: "contributors" }}
                className="underline underline-offset-2"
              >
                contributor flow <ArrowUpRightIcon aria-hidden className="inline" />
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
