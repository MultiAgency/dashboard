import {
  ArrowUpRightIcon,
  PlusIcon,
  ReceiptIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
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
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Empty, Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldLegend, FieldSet } from "@/components/ui/field";
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
    <div className="flex flex-col gap-6">
      {creating && (
        <BillingCreateForm
          projectId={projectId}
          contributors={contributors}
          orgAccountId={orgAccountId}
          onDone={() => setCreating(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Billings</h2>
          </CardTitle>
          <CardDescription>
            Payouts on this project, read from DAO Transfer proposals.
          </CardDescription>
          {orgAccountId && !creating && (
            <CardAction>
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon data-icon="inline-start" aria-hidden />
                Record billing
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {billingsQuery.isError ? (
            <AdminError error={billingsQuery.error} />
          ) : billingsQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : billings.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Proposal</TableHead>
                    <TableHead scope="col">Amount</TableHead>
                    <TableHead scope="col">Date</TableHead>
                    <TableHead scope="col">Note</TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billings.map((b) => (
                    <BillingRow key={b.id} billing={b} orgAccountId={orgAccountId} />
                  ))}
                </TableBody>
              </Table>
              {billingsQuery.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => billingsQuery.fetchNextPage()}
                    disabled={billingsQuery.isFetchingNextPage}
                  >
                    {billingsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty icon={<ReceiptIcon aria-hidden />} label="No billings recorded yet" />
          )}
        </CardContent>
      </Card>
    </div>
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
    <TableRow>
      <TableCell>
        <Badge variant={statusBadgeVariant(billing.status)}>{billing.status}</Badge>
      </TableCell>
      <TableCell>
        {billing.payingDaoAccountId ? (
          <a
            href={trezuProposalUrl(billing.payingDaoAccountId, billing.proposalId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            #{billing.proposalId}
            <ArrowUpRightIcon aria-hidden className="text-muted-foreground" />
          </a>
        ) : (
          <span>#{billing.proposalId}</span>
        )}
        {!ownBilling && (
          <span className="block text-muted-foreground">paid by {billing.payingDaoAccountId}</span>
        )}
      </TableCell>
      <TableCell className="font-medium tabular-nums">
        {formatTokenAmount(billing.amount, billing.tokenId)}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {new Date(billing.createdAt).toISOString().slice(0, 10)}
      </TableCell>
      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
        {billing.note ?? "—"}
      </TableCell>
      <TableCell>
        {ownBilling && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete billing for proposal #${billing.proposalId}`}
              onClick={() => setConfirmOpen(true)}
              disabled={deleteMutation.isPending}
            >
              <TrashIcon aria-hidden />
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete billing for proposal #${billing.proposalId}?`}
          description="You can re-record it afterwards. Chain status remains the source of truth."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
          }}
        />
      </TableCell>
    </TableRow>
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
      <CardHeader>
        <CardTitle>
          <h2>Record a billing</h2>
        </CardTitle>
        <CardDescription>
          Paste a Sputnik DAO Transfer proposal ID. Token, amount and recipient are read from chain.
        </CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            {orgAccountId && payableContributors.length > 0 && (
              <div className="bg-muted p-4">
                <FieldSet>
                  <FieldLegend variant="label">Need to create the proposal first?</FieldLegend>
                  <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
                    <Field label="Recipient" htmlFor="prefill-contributor">
                      <ChoiceSelect
                        id="prefill-contributor"
                        value={prefillNearAccount}
                        onValueChange={setPrefillNearAccount}
                        options={payableContributors.map((c) => ({
                          value: c.nearAccount,
                          label: `${c.name} (${c.nearAccount})`,
                        }))}
                      />
                    </Field>
                    <Field label="Token" htmlFor="prefill-token">
                      <ChoiceSelect
                        id="prefill-token"
                        value={prefillTokenId}
                        onValueChange={setPrefillTokenId}
                        emptyLabel="Pick in Trezu"
                        options={tokens.map((t) => ({
                          value: t.tokenId,
                          label: `${t.symbol} · ${t.name}`,
                        }))}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Set the amount in Trezu, submit the proposal, then paste its ID below.
                    </p>
                    {trezuPrefillUrl && (
                      <Button asChild variant="outline" size="sm">
                        <a href={trezuPrefillUrl} target="_blank" rel="noopener noreferrer">
                          Open in Trezu
                          <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                        </a>
                      </Button>
                    )}
                  </div>
                </FieldSet>
              </div>
            )}
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field
                label="Proposal ID"
                htmlFor="new-bill-proposal"
                helper="From Trezu, or NEARN's Pay with NEAR Treasury. Non-Transfer proposals are rejected."
              >
                <Input
                  id="new-bill-proposal"
                  value={proposalId}
                  onChange={(e) => setProposalId(e.target.value)}
                  placeholder="e.g. 42"
                  disabled={isPending}
                />
              </Field>
              <Field
                label="Builder override"
                htmlFor="new-bill-contributor"
                helper="Rarely needed. Leave blank to detect the builder from the recipient."
              >
                <Input
                  id="new-bill-contributor"
                  value={nearAccountOverride}
                  onChange={(e) => setNearAccountOverride(e.target.value)}
                  placeholder="builder.near"
                  disabled={isPending}
                />
              </Field>
            </div>
            <Field label="Note" htmlFor="new-bill-note">
              <Textarea
                id="new-bill-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Optional"
                disabled={isPending}
              />
            </Field>
            {showBuilderWarning && (
              <Alert>
                <WarningIcon aria-hidden />
                <AlertTitle>Not registered as a builder: {targetContributorName}</AlertTitle>
                <AlertDescription>
                  Convert the contributor application to a builder profile, or add them as a
                  builder, before recording a payout.{" "}
                  <Link
                    to="/docs/$slug"
                    params={{ slug: "contributors" }}
                    className="underline underline-offset-2"
                  >
                    Contributor flow
                  </Link>
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" onClick={onDone} variant="outline" disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? "Recording…" : "Record billing"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
