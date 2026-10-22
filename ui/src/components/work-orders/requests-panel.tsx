import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  Input,
  Textarea,
} from "@/components";
import { Empty, Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { useAuthClient } from "@/lib/auth";
import {
  baseToDecimal,
  formatTokenAmount,
  parseDecimalToBase,
  tokenDecimals,
  tokenSymbol,
} from "@/lib/format-amount";
import { adminWorkOrdersQueryKey, payoutAgentQueryOptions } from "@/lib/queries";
import { ReportMarkdown } from "./report-markdown";
import {
  type CompensationRequest,
  RequestStatusBadge,
  type WorkOrderDetail,
} from "./work-order-status";

export function RequestsPanel({
  workOrder,
  canManage,
  hasTreasury,
}: {
  workOrder: WorkOrderDetail;
  canManage: boolean;
  hasTreasury: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
  const draft = useMutation({
    mutationFn: () => apiClient.workOrders.draftRequest({ id: workOrder.id }),
    onSuccess: async (request) => {
      await refresh();
      toast.success(`${request.code} drafted; the builder can now edit and submit it`);
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't draft a request"),
  });
  const canDraft =
    canManage &&
    (workOrder.status === "active" || workOrder.status === "ended") &&
    !workOrder.requests.some((r) => r.status === "draft") &&
    BigInt(workOrder.remainingAmount) > 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Compensation requests</h2>
        </CardTitle>
        <CardDescription>
          The builder submits a report for a period; you approve an amount up to the remaining
          budget. When the payout agent is ready it pays the builder right away; otherwise pay it
          through a transfer proposal of the Agency DAO.
        </CardDescription>
        {canDraft && (
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              disabled={draft.isPending}
              onClick={() => draft.mutate()}
            >
              Draft a request
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {workOrder.requests.length === 0 ? (
          <Empty
            label="No requests yet."
            description="A request is drafted automatically when the period ends."
          />
        ) : (
          workOrder.requests
            .slice()
            .reverse()
            .map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                workOrder={workOrder}
                canManage={canManage}
                hasTreasury={hasTreasury}
              />
            ))
        )}
      </CardContent>
    </Card>
  );
}

function RequestItem({
  request,
  workOrder,
  canManage,
  hasTreasury,
}: {
  request: CompensationRequest;
  workOrder: WorkOrderDetail;
  canManage: boolean;
  hasTreasury: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<null | "approve" | "reject" | "proposal">(null);
  const payoutAgent = useQuery({ ...payoutAgentQueryOptions(apiClient), enabled: canManage }).data;
  const autoPays =
    !!payoutAgent?.ready && (workOrder.tokenId === "usd" || workOrder.tokenId === "near");
  const payNow = useMutation({
    mutationFn: () => apiClient.workOrders.payNow({ requestId: request.id }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(
        updated.status === "paid" ? `${updated.code} is paid` : "Payout sent; it settles shortly",
      );
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't pay it"),
  });
  const [showReport, setShowReport] = useState(request.status === "submitted");
  const amount = (value: string | null) =>
    value ? formatTokenAmount(value, workOrder.tokenId) : "—";
  const refreshPayment = useMutation({
    mutationFn: () => apiClient.workOrders.refreshPayment({ requestId: request.id }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(
        updated.status === "paid" ? `${updated.code} is paid` : "The proposal is still open",
      );
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't read the proposal"),
  });

  return (
    <section className="flex flex-col gap-3 border p-4" aria-label={request.code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{request.code}</span>
        <RequestStatusBadge status={request.status} />
        <span className="text-sm text-muted-foreground tabular-nums">
          {request.coversFrom} → {request.coversTo}
        </span>
        <span className="ml-auto text-sm tabular-nums">
          Requested {amount(request.requestedAmount)}
          {request.approvedAmount ? ` · approved ${amount(request.approvedAmount)}` : ""}
        </span>
      </div>
      {request.note && <p className="text-sm text-muted-foreground">{request.note}</p>}
      {request.autoPayBlocked && (
        <p className="text-sm text-muted-foreground">
          Waiting to be paid automatically since{" "}
          {request.autoPayBlocked.since.slice(0, 16).replace("T", " ")} UTC
          {request.autoPayBlocked.triedAt
            ? `, last tried ${request.autoPayBlocked.triedAt.slice(11, 16)} UTC`
            : ""}
          .
        </p>
      )}
      {request.overlaps.length > 0 && (
        <p className="text-sm text-destructive">
          Its dates overlap {request.overlaps.join(", ")}, already approved or paid: check the same
          work isn't paid twice.
        </p>
      )}
      {request.proposalId && (
        <p className="text-sm text-muted-foreground">
          Paid through proposal #{request.proposalId}
          {request.payingDaoAccountId ? ` of ${request.payingDaoAccountId}` : ""}
          {request.paidAt ? `, approved ${request.paidAt.slice(0, 10)}` : ""}.
        </p>
      )}
      {request.proposalId && request.payout?.priceUsd && (
        <p className="text-sm text-muted-foreground">
          {formatTokenAmount(request.payout.amount, request.payout.tokenId)} at $
          {request.payout.priceUsd} per {tokenSymbol(request.payout.tokenId)}, priced{" "}
          {request.payout.pricedAt?.slice(0, 16).replace("T", " ")} UTC.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {request.reportMd && (
          <Button size="sm" variant="ghost" onClick={() => setShowReport((v) => !v)}>
            {showReport ? "Hide report" : "Show report"}
          </Button>
        )}
        {canManage && request.status === "submitted" && (
          <>
            <Button size="sm" onClick={() => setOpen("approve")}>
              Approve an amount
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen("reject")}>
              Reject
            </Button>
          </>
        )}
        {canManage && request.status === "approved" && (
          <>
            {autoPays && (
              <Button size="sm" disabled={payNow.isPending} onClick={() => payNow.mutate()}>
                {payNow.isPending ? "Paying…" : "Pay now (NEAR Intents)"}
              </Button>
            )}
            <Button
              size="sm"
              variant={autoPays ? "outline" : "default"}
              disabled={!hasTreasury}
              onClick={() => setOpen("proposal")}
            >
              Pay through a DAO proposal
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen("reject")}>
              Reject
            </Button>
          </>
        )}
        {request.agentPayout && request.status !== "approved" && (
          <span className="text-sm text-muted-foreground">
            {request.agentPayout.status === "paid" ? "Paid " : "Paying "}
            {formatTokenAmount(request.agentPayout.amount, "near")} through the payout agent
            {request.agentPayout.txUrl ? (
              <>
                {" · "}
                <a
                  href={request.agentPayout.txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  transaction
                </a>
              </>
            ) : null}
          </span>
        )}
        {request.status === "proposed" && (
          <Button
            size="sm"
            variant="outline"
            disabled={refreshPayment.isPending}
            onClick={() => refreshPayment.mutate()}
          >
            Check the proposal
          </Button>
        )}
      </div>
      {showReport && request.reportMd && (
        <div className="border-t pt-3">
          <ReportMarkdown markdown={request.reportMd} />
        </div>
      )}
      {showReport && !request.reportMd && <ReportMarkdown markdown={request.contributionsMd} />}
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {open === "approve" && (
            <ApproveForm request={request} workOrder={workOrder} onDone={() => setOpen(null)} />
          )}
          {open === "reject" && <RejectForm request={request} onDone={() => setOpen(null)} />}
          {open === "proposal" && (
            <ProposalForm request={request} workOrder={workOrder} onDone={() => setOpen(null)} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ApproveForm({
  request,
  workOrder,
  onDone,
}: {
  request: CompensationRequest;
  workOrder: WorkOrderDetail;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const payoutAgent = useQuery(payoutAgentQueryOptions(apiClient)).data;
  const autoPays =
    !!payoutAgent?.ready && (workOrder.tokenId === "usd" || workOrder.tokenId === "near");
  const decimals = tokenDecimals(workOrder.tokenId);
  const toDecimal = (value: string) =>
    decimals === undefined ? value : baseToDecimal(value, decimals);
  const [value, setValue] = useState(toDecimal(request.requestedAmount));
  const pending = workOrder.evidence.filter((e) => !e.authorized && e.kind === "unlinked_pr");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [withoutEvidence, setWithoutEvidence] = useState(false);
  const needsEvidenceConfirm = request.authorizedEvidence === 0 && confirmed.length === 0;
  let base = "";
  let error = "";
  try {
    base = decimals === undefined ? value.trim() : parseDecimalToBase(value.trim(), decimals);
  } catch (e) {
    error = (e as Error).message;
  }
  const over = base && BigInt(base) > BigInt(workOrder.remainingAmount);
  const blocked = needsEvidenceConfirm && !withoutEvidence;
  const approve = useMutation({
    mutationFn: () =>
      apiClient.workOrders.approveRequest({
        requestId: request.id,
        amount: base,
        confirmEvidenceIds: confirmed,
        allowWithoutEvidence: needsEvidenceConfirm && withoutEvidence,
      }),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(
        updated.status === "paid"
          ? `${updated.code} approved and paid through the payout agent`
          : updated.status === "paying"
            ? `${updated.code} approved; the payout is on its way`
            : updated.note
              ? `${updated.code} approved. ${updated.note}`
              : `${updated.code} approved. Pay it through a DAO proposal.`,
      );
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't approve the request"),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (base && !error && !over && !blocked) approve.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Approve {request.code}</DialogTitle>
        <DialogDescription>
          Up to {formatTokenAmount(workOrder.remainingAmount, workOrder.tokenId)} remains.{" "}
          {autoPays
            ? "Approving pays it right away in NEAR through your payout agent."
            : "Approving reserves it; the money moves once the DAO approves the transfer proposal."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field label="Amount" htmlFor="approve-amount">
          <Input
            id="approve-amount"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {(error || over) && (
          <p className="text-sm text-destructive">
            {error || "That's more than the remaining budget."}
          </p>
        )}
        {pending.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Confirm other merged work</legend>
            {pending.map((item) => (
              <label key={item.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed.includes(item.id)}
                  onChange={(e) =>
                    setConfirmed((current) =>
                      e.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  {item.repo}#{item.number} {item.title}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {needsEvidenceConfirm && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={withoutEvidence}
              onChange={(e) => setWithoutEvidence(e.target.checked)}
            />
            <span>
              No work in this request was approved by the repository owner. Approve it anyway, based
              on the report.
            </span>
          </label>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={!base || !!error || !!over || blocked || approve.isPending}>
          {approve.isPending ? "Approving…" : "Approve"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RejectForm({ request, onDone }: { request: CompensationRequest; onDone: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const reject = useMutation({
    mutationFn: () =>
      apiClient.workOrders.rejectRequest({ requestId: request.id, note: note.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success(`${request.code} rejected`);
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't reject the request"),
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) reject.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Reject {request.code}</DialogTitle>
        <DialogDescription>
          The builder sees your reason and can draft a new request.
        </DialogDescription>
      </DialogHeader>
      <Field label="Reason" htmlFor="reject-note">
        <Textarea
          id="reject-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="submit" variant="destructive" disabled={!note.trim() || reject.isPending}>
          Reject
        </Button>
      </DialogFooter>
    </form>
  );
}

function proposalIdOf(outcome: unknown): string | null {
  const status = (outcome as { status?: { SuccessValue?: unknown } } | null)?.status;
  if (typeof status?.SuccessValue !== "string" || !status.SuccessValue) return null;
  try {
    const value = JSON.parse(atob(status.SuccessValue));
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  } catch {
    return null;
  }
}

function ProposalForm({
  request,
  workOrder,
  onDone,
}: {
  request: CompensationRequest;
  workOrder: WorkOrderDetail;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const [proposalId, setProposalId] = useState("");
  const linked = async (updated: CompensationRequest) => {
    await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["admin", "billings"] });
    toast.success(
      updated.status === "paid"
        ? `${updated.code} is paid`
        : `Proposal #${updated.proposalId} linked`,
    );
    onDone();
  };
  const link = useMutation({
    mutationFn: (id: string) =>
      apiClient.workOrders.linkProposal({ requestId: request.id, proposalId: id }),
    onSuccess: linked,
    onError: (err: Error) => toast.error(err.message || "Couldn't link the proposal"),
  });
  const quote = useQuery({
    queryKey: ["admin", "work-orders", "quote", request.id],
    queryFn: () => apiClient.workOrders.paymentProposal({ requestId: request.id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  const create = useMutation({
    mutationFn: async () => {
      const tx =
        quote.data ?? (await apiClient.workOrders.paymentProposal({ requestId: request.id }));
      await authClient.near.ensureConnected();
      const signer = authClient.near.getAccountId();
      if (!signer) throw new Error("Connect your NEAR wallet first");
      const outcome = await authClient.near
        .getNearClient()
        .transaction(signer)
        .functionCall(tx.daoAccountId, tx.method, tx.args, {
          gas: tx.gas as `${number}`,
          attachedDeposit: BigInt(tx.deposit),
        })
        .send({ waitUntil: "FINAL" });
      const id = proposalIdOf(outcome);
      if (!id) {
        throw new Error("The proposal was sent, but its number couldn't be read. Enter it below.");
      }
      setProposalId(id);
      return apiClient.workOrders.linkProposal({ requestId: request.id, proposalId: id });
    },
    onSuccess: linked,
    onError: (err: Error) => toast.error(err.message || "Couldn't create the proposal"),
  });
  const busy = link.isPending || create.isPending || quote.isFetching;
  const q = quote.data?.quote;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (/^\d+$/.test(proposalId.trim())) link.mutate(proposalId.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>Pay through the Agency DAO</DialogTitle>
        <DialogDescription>
          A transfer proposal paying {workOrder.builder.nearAccount}. It becomes a billing on the
          project, and the request is paid when the DAO approves it.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1 border p-3">
        {quote.isError ? (
          <span className="text-sm text-destructive">{(quote.error as Error).message}</span>
        ) : !q ? (
          <span className="text-sm text-muted-foreground">Getting the amount…</span>
        ) : (
          <>
            <span className="text-lg font-medium tabular-nums">
              {formatTokenAmount(q.amount, q.tokenId)}
            </span>
            {q.priceUsd && q.usd && (
              <span className="text-xs text-muted-foreground">
                {formatTokenAmount(q.usd, "usd")} at ${q.priceUsd} per {tokenSymbol(q.tokenId)},
                quoted {q.pricedAt?.slice(11, 16)} UTC. The proposal must pay exactly this amount.
              </span>
            )}
          </>
        )}
        {workOrder.tokenId === "usd" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={quote.isFetching}
            onClick={() => quote.refetch()}
          >
            {quote.isFetching ? "Pricing…" : "Refresh the quote"}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" disabled={busy || !q} onClick={() => create.mutate()}>
          {create.isPending ? "Waiting for the wallet…" : "Create the proposal with my wallet"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your wallet signs add_proposal on the DAO with its proposal bond as the deposit. Your
          account needs permission to add transfer proposals.
        </p>
      </div>
      <Field label="Or link one made elsewhere (e.g. Trezu)" htmlFor="proposal-id">
        <Input
          id="proposal-id"
          inputMode="numeric"
          placeholder="Proposal number"
          value={proposalId}
          onChange={(e) => setProposalId(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="submit" variant="outline" disabled={!/^\d+$/.test(proposalId.trim()) || busy}>
          {link.isPending ? "Checking…" : "Link proposal"}
        </Button>
      </DialogFooter>
    </form>
  );
}
