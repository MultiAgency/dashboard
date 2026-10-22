import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
  PageHeader,
  Textarea,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BuilderSigning } from "@/components/work-orders/builder-signing";
import { EvidenceList } from "@/components/work-orders/evidence-list";
import { ReportMarkdown } from "@/components/work-orders/report-markdown";
import {
  type CompensationRequest,
  RequestStatusBadge,
  WorkOrderStatusBadge,
} from "@/components/work-orders/work-order-status";
import { type ApiClient, useApiClient } from "@/lib/api";
import {
  baseToDecimal,
  formatTokenAmount,
  parseDecimalToBase,
  tokenDecimals,
} from "@/lib/format-amount";
import { myWorkOrderQueryOptions, myWorkOrdersQueryKey } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/work-orders/$id")({
  head: () => ({ meta: [{ title: "Work order" }] }),
  component: MyWorkOrderPage,
});

type MyWorkOrder = Awaited<ReturnType<ApiClient["myWorkOrders"]["get"]>>;
type ManualItem = CompensationRequest["manualItems"][number];

function MyWorkOrderPage() {
  const { id } = Route.useParams();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(myWorkOrderQueryOptions(apiClient, id));
  const [declining, setDeclining] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: myWorkOrdersQueryKey });

  const decline = useMutation({
    mutationFn: () => apiClient.myWorkOrders.decline({ id, note: null }),
    onSuccess: async () => {
      await refresh();
      toast.success("Declined. The Agency is told.");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't decline"),
  });
  const confirmPayee = useMutation({
    mutationFn: () => apiClient.myWorkOrders.confirmPayee({ id }),
    onSuccess: async () => {
      await refresh();
      toast.success("Payout account confirmed");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't confirm the payout account"),
  });
  const draft = useMutation({
    mutationFn: () => apiClient.myWorkOrders.draftRequest({ id }),
    onSuccess: async () => {
      await refresh();
      toast.success("Request drafted from your GitHub work");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't draft a request"),
  });

  if (query.isError) return <AdminError error={query.error} />;
  if (!query.data) return <Loading label="Loading the work order" />;
  const wo = query.data;
  const payable = ["active", "ended", "exhausted"].includes(wo.status);
  const openDraft = wo.requests.find((r) => r.status === "draft");
  const amount = (value: string) => formatTokenAmount(value, wo.tokenId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/dashboard"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← My work
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {wo.code}
            <WorkOrderStatusBadge status={wo.status} />
          </span>
        }
        description={`${wo.title} · ${wo.projectTitle} · with ${wo.agencyName}`}
      />

      {(wo.status === "offered" || wo.signing.builder || wo.documentSha256) && (
        <BuilderSigning workOrder={wo} onDecline={() => setDeclining(true)} />
      )}

      {wo.payee.needsConfirmation && wo.status !== "offered" && (
        <Alert>
          <AlertTitle>Confirm your payout account</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              {wo.agencyName} hasn't paid {wo.payee.account} before. You're signed in with that NEAR
              account, so confirming proves it's yours. It's free and moves no money.
            </span>
            <Button
              size="sm"
              className="self-start"
              disabled={confirmPayee.isPending}
              onClick={() => confirmPayee.mutate()}
            >
              Confirm {wo.payee.account}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Terms</h2>
          </CardTitle>
          <CardDescription>
            Work counts once the repository owner approves or merges your pull request on GitHub.
            The budget is a maximum, not a guarantee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Period</dt>
            <dd>
              {wo.periodStart} → {wo.periodEnd} (+ {wo.graceDays} grace days)
            </dd>
            <dt className="text-muted-foreground">Budget</dt>
            <dd className="tabular-nums">
              {amount(wo.budgetAmount)} cap · {amount(wo.paidAmount)} paid ·{" "}
              {amount(wo.remainingAmount)} left
            </dd>
            <dt className="text-muted-foreground">Repositories</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {wo.repoOwners.map((o) => (
                  <li key={o.repo}>
                    <a
                      href={`https://github.com/${o.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {o.repo}
                    </a>
                    <span className="block text-xs text-muted-foreground">
                      {o.error
                        ? "Owner unknown"
                        : `Accepted by ${o.approvers.length ? o.approvers.map((a) => `@${a}`).join(", ") : o.owner}`}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
            {wo.scope && (
              <>
                <dt className="text-muted-foreground">Authorized work</dt>
                <dd className="whitespace-pre-wrap">{wo.scope}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Monthly renewal</dt>
            <dd>
              {wo.autoRenew
                ? "Renews by itself each month when the base metrics are met; otherwise the Agency decides."
                : "No"}
            </dd>
            <dt className="text-muted-foreground">Payee</dt>
            <dd>
              {wo.builder.nearAccount}
              {wo.payee.confirmedAt ? (
                <span className="text-muted-foreground">
                  {" "}
                  · confirmed {wo.payee.confirmedAt.slice(0, 10)}
                </span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">GitHub login</dt>
            <dd>{wo.builder.githubLogin ? `@${wo.builder.githubLogin}` : "Not set yet"}</dd>
            {wo.signature.method && (
              <>
                <dt className="text-muted-foreground">Signed</dt>
                <dd>
                  {wo.signature.method === "google_esign"
                    ? "E-signed in Google Docs"
                    : "Accepted here"}{" "}
                  on {wo.signature.signedAt?.slice(0, 10)}
                  {wo.documentUrl ? (
                    <>
                      {" · "}
                      <a
                        href={wo.documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        signed document
                      </a>
                    </>
                  ) : null}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Terms fingerprint</dt>
            <dd className="font-mono text-xs break-all">{wo.termsHash}</dd>
          </dl>
        </CardContent>
      </Card>

      {payable && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Compensation requests</h2>
            </CardTitle>
            <CardDescription>
              At the end of each period a request is drafted from your GitHub work. Write your
              assessment, add work GitHub can't see, set the amount and submit it.
            </CardDescription>
            {!openDraft && BigInt(wo.remainingAmount) > 0n && wo.status !== "exhausted" && (
              <CardAction>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={draft.isPending}
                  onClick={() => draft.mutate()}
                >
                  Draft a request now
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {wo.requests.length === 0 ? (
              <Empty label="No requests yet." />
            ) : (
              wo.requests
                .slice()
                .reverse()
                .map((request) =>
                  request.status === "draft" ? (
                    <DraftEditor key={request.id} request={request} workOrder={wo} />
                  ) : (
                    <SubmittedRequest key={request.id} request={request} tokenId={wo.tokenId} />
                  ),
                )
            )}
          </CardContent>
        </Card>
      )}

      {payable && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Your work on GitHub</h2>
            </CardTitle>
            <CardDescription>
              {wo.lastCollectedAt
                ? `Last collected ${wo.lastCollectedAt.slice(0, 16).replace("T", " ")}.`
                : "Collected every 6 hours."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EvidenceList evidence={wo.evidence} />
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={declining}
        onOpenChange={setDeclining}
        title={`Decline ${wo.code}?`}
        description={`${wo.agencyName} is told. They can change the terms and offer it again.`}
        confirmLabel="Decline"
        destructive
        onConfirm={() => decline.mutateAsync().then(() => undefined)}
      />
    </div>
  );
}

function SubmittedRequest({ request, tokenId }: { request: CompensationRequest; tokenId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3 border p-4" aria-label={request.code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{request.code}</span>
        <RequestStatusBadge status={request.status} />
        <span className="text-sm text-muted-foreground tabular-nums">
          {request.coversFrom} → {request.coversTo}
        </span>
        <span className="ml-auto text-sm tabular-nums">
          {formatTokenAmount(request.approvedAmount ?? request.requestedAmount, tokenId)}
        </span>
      </div>
      {request.note && <p className="text-sm text-muted-foreground">{request.note}</p>}
      {request.reportMd && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide report" : "Show report"}
          </Button>
          {open && (
            <div className="border-t pt-3">
              <ReportMarkdown markdown={request.reportMd} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DraftEditor({
  request,
  workOrder,
}: {
  request: CompensationRequest;
  workOrder: MyWorkOrder;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const decimals = tokenDecimals(workOrder.tokenId);
  const toDecimal = (value: string) =>
    decimals === undefined ? value : baseToDecimal(value, decimals);
  const [assessment, setAssessment] = useState(request.assessmentMd);
  const [items, setItems] = useState<ManualItem[]>(request.manualItems);
  const [amount, setAmount] = useState(toDecimal(request.requestedAmount));
  const [newItem, setNewItem] = useState({ title: "", url: "" });
  const [confirming, setConfirming] = useState(false);
  let base = "";
  let amountError = "";
  try {
    base = decimals === undefined ? amount.trim() : parseDecimalToBase(amount.trim(), decimals);
  } catch (e) {
    amountError = (e as Error).message;
  }
  const over = !!base && BigInt(base) > BigInt(workOrder.remainingAmount);
  const zero = !base || BigInt(base) <= 0n;
  const dirty =
    assessment !== request.assessmentMd ||
    JSON.stringify(items) !== JSON.stringify(request.manualItems) ||
    base !== request.requestedAmount;

  const save = useMutation({
    mutationFn: () =>
      apiClient.myWorkOrders.editRequest({
        requestId: request.id,
        assessmentMd: assessment,
        manualItems: items,
        requestedAmount: base,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myWorkOrdersQueryKey });
      toast.success("Draft saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save the draft"),
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return apiClient.myWorkOrders.submitRequest({ requestId: request.id });
    },
    onSuccess: async (submitted) => {
      await queryClient.invalidateQueries({ queryKey: myWorkOrdersQueryKey });
      toast.success(`${submitted.code} submitted for approval`);
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't submit the request"),
  });
  const urlOk = /^https?:\/\/\S+$/.test(newItem.url.trim());

  return (
    <section className="flex flex-col gap-4 border p-4" aria-label={request.code}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{request.code}</span>
        <RequestStatusBadge status={request.status} />
        <span className="text-sm text-muted-foreground tabular-nums">
          {request.coversFrom} → {request.coversTo}
        </span>
      </div>
      <div className="border p-3">
        <ReportMarkdown markdown={request.contributionsMd} />
      </div>
      <FieldGroup>
        <Field
          label="Your assessment"
          htmlFor={`assess-${request.id}`}
          helper={
            request.assessmentIsDraft
              ? "Replace the template with what you did and why it matters."
              : undefined
          }
        >
          <Textarea
            id={`assess-${request.id}`}
            rows={8}
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Work GitHub can't see</span>
          {items.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((item, i) => (
                <li key={`${item.url}-${i}`} className="flex items-center gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setItems((current) => current.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label="What"
              placeholder="What (e.g. design review)"
              value={newItem.title}
              onChange={(e) => setNewItem((c) => ({ ...c, title: e.target.value }))}
            />
            <Input
              aria-label="Link"
              placeholder="https://…"
              value={newItem.url}
              onChange={(e) => setNewItem((c) => ({ ...c, url: e.target.value }))}
            />
            <Button
              variant="outline"
              disabled={!newItem.title.trim() || !urlOk || items.length >= 50}
              onClick={() => {
                setItems((current) => [
                  ...current,
                  { title: newItem.title.trim(), url: newItem.url.trim(), date: null, note: null },
                ]);
                setNewItem({ title: "", url: "" });
              }}
            >
              Add
            </Button>
          </div>
        </div>
        <Field
          label="Requested amount"
          htmlFor={`amount-${request.id}`}
          helper={`Up to ${formatTokenAmount(workOrder.remainingAmount, workOrder.tokenId)} remains.`}
        >
          <Input
            id={`amount-${request.id}`}
            inputMode="decimal"
            value={amount}
            aria-invalid={!!amountError || over}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {(amountError || over) && (
          <p className="text-sm text-destructive">
            {amountError || "That's more than the remaining budget."}
          </p>
        )}
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!dirty || !!amountError || over || zero || save.isPending}
          onClick={() => save.mutate()}
        >
          Save draft
        </Button>
        <Button
          disabled={!!amountError || over || zero || submit.isPending}
          onClick={() => setConfirming(true)}
        >
          Submit for approval
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Submit ${request.code}?`}
        description="The report is frozen and sent to the Agency. You can't edit it after this."
        confirmLabel="Submit"
        onConfirm={() => submit.mutateAsync().then(() => undefined)}
      />
    </section>
  );
}
