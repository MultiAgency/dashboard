import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeader,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EvidenceList } from "@/components/work-orders/evidence-list";
import { PayeePayoutsPrompt } from "@/components/work-orders/payee-payouts-prompt";
import { RenewalPanel } from "@/components/work-orders/renewal-panel";
import { RequestsPanel } from "@/components/work-orders/requests-panel";
import { SigningPanel } from "@/components/work-orders/signing-panel";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import {
  RenewalBadge,
  type WorkOrderDetail,
  WorkOrderStatusBadge,
} from "@/components/work-orders/work-order-status";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { formatTokenAmount } from "@/lib/format-amount";
import { adminWorkOrderQueryOptions, adminWorkOrdersQueryKey } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/work-orders/$id")({
  head: () => ({ meta: [{ title: "Work order" }] }),
  component: WorkOrderPage,
});

type Action = "offer" | "activate" | "terminate" | "delete" | "collect";

function WorkOrderPage() {
  const { id } = Route.useParams();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { canAccessAdmin: canManage, agencyDao } = useMeRoles();
  const query = useQuery(adminWorkOrderQueryOptions(apiClient, id));
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<null | "terminate" | "delete">(null);
  const [documenting, setDocumenting] = useState(false);

  const act = useMutation({
    mutationFn: async (action: Action) => {
      if (action === "offer") return apiClient.workOrders.offer({ id });
      if (action === "activate") return apiClient.workOrders.activate({ id });
      if (action === "terminate") return apiClient.workOrders.terminate({ id });
      if (action === "collect") return apiClient.workOrders.collect({ id });
      return apiClient.workOrders.delete({ id });
    },
    onSuccess: async (result, action) => {
      if (action === "delete") {
        await navigate({ to: "/admin/work-orders" });
        queryClient.removeQueries({
          queryKey: adminWorkOrderQueryOptions(apiClient, id).queryKey,
          exact: true,
        });
      }
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      const signFirst =
        action === "offer" &&
        typeof result === "object" &&
        result !== null &&
        "signing" in result &&
        result.signing.awaitingRepresentative;
      const done: Record<Action, string> = {
        offer: signFirst
          ? "Ready to sign: sign it in Documenso to send it to the builder"
          : "Offered to the builder; they accept it from My work",
        activate: "Active: the work period has started",
        terminate: "Terminated: nothing more is paid under it",
        delete: "Deleted",
        collect: "Evidence collected from GitHub",
      };
      toast.success(done[action]);
    },
    onError: (err: Error) => toast.error(err.message || "Something went wrong"),
  });

  if (query.isError) return <AdminError error={query.error} />;
  if (!query.data) return <Loading label="Loading the work order" />;
  const wo = query.data;
  const editable = canManage && ["draft", "offered", "accepted"].includes(wo.status);
  const payable = ["active", "ended", "exhausted"].includes(wo.status);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/work-orders"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Work orders
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {wo.code}
            <WorkOrderStatusBadge status={wo.status} />
            {wo.renewal && <RenewalBadge status={wo.renewal.status} />}
            {wo.autoRenew && !wo.renewal && <Badge variant="secondary">Renews monthly</Badge>}
          </span>
        }
        description={`${wo.title} · ${wo.projectTitle}`}
        actions={
          canManage && (
            <>
              {payable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate("collect")}
                >
                  Collect now
                </Button>
              )}
              {editable && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {wo.status === "draft" && (
                <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("offer")}>
                  Offer to the builder
                </Button>
              )}
              {wo.status === "accepted" && (
                <Button
                  size="sm"
                  disabled={act.isPending || wo.activationBlockers.length > 0}
                  onClick={() => act.mutate("activate")}
                >
                  Activate
                </Button>
              )}
              {(wo.status === "draft" || wo.status === "offered") && (
                <Button size="sm" variant="ghost" onClick={() => setConfirming("delete")}>
                  Delete
                </Button>
              )}
              {wo.status !== "terminated" && wo.status !== "draft" && wo.status !== "offered" && (
                <Button size="sm" variant="ghost" onClick={() => setConfirming("terminate")}>
                  Terminate
                </Button>
              )}
            </>
          )
        }
      />

      {wo.activationBlockers.length > 0 && (
        <Alert>
          <AlertTitle>Before it can start</AlertTitle>
          <AlertDescription>It starts automatically once these are done.</AlertDescription>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {wo.activationBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
          {canManage &&
            wo.signing.awaitingRepresentative &&
            wo.signing.esign?.representativeUrl && (
              <AlertDescription>
                <Button size="sm" className="mt-2" asChild>
                  <a href={wo.signing.esign.representativeUrl} target="_blank" rel="noreferrer">
                    {wo.representativeName
                      ? `Sign as ${wo.representativeName} to send it`
                      : "Sign in Documenso to send it"}
                  </a>
                </Button>
              </AlertDescription>
            )}
        </Alert>
      )}

      {canManage && <PayeePayoutsPrompt workOrder={wo} />}

      <Summary workOrder={wo} />
      <SigningPanel workOrder={wo} canManage={canManage} onAttach={() => setDocumenting(true)} />
      <RenewalPanel workOrder={wo} canManage={canManage} />
      {payable && (
        <RequestsPanel workOrder={wo} canManage={canManage} hasTreasury={agencyDao !== null} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Evidence</h2>
          </CardTitle>
          <CardDescription>
            {wo.lastCollectedAt
              ? `Collected from GitHub on ${wo.lastCollectedAt.slice(0, 16).replace("T", " ")}. It's collected again every 6 hours.`
              : "Collected from GitHub once the work order is active."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EvidenceList evidence={wo.evidence} />
        </CardContent>
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {editing && <WorkOrderForm editing={wo} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={documenting} onOpenChange={setDocumenting}>
        <DialogContent className="sm:max-w-lg">
          {documenting && <DocumentForm workOrder={wo} onDone={() => setDocumenting(false)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming === "delete" ? `Delete ${wo.code}?` : `Terminate ${wo.code}?`}
        description={
          confirming === "delete"
            ? "The draft is removed. The builder hasn't started work under it."
            : "Nothing more can be approved or paid under it. Requests already linked to a DAO proposal keep their billing."
        }
        confirmLabel={confirming === "delete" ? "Delete" : "Terminate"}
        destructive
        onConfirm={() =>
          act.mutateAsync(confirming === "delete" ? "delete" : "terminate").then(() => undefined)
        }
      />
    </div>
  );
}

function Summary({ workOrder: wo }: { workOrder: WorkOrderDetail }) {
  const rows: [string, React.ReactNode][] = [
    [
      "Builder",
      <span key="b">
        {wo.builder.name ?? wo.builder.nearAccount}{" "}
        <span className="text-muted-foreground">
          · paid to {wo.builder.nearAccount}
          {wo.builder.githubLogin ? ` · @${wo.builder.githubLogin}` : " · no GitHub login"}
        </span>
      </span>,
    ],
    ["Project", wo.projectTitle],
    [
      "Period",
      `${wo.periodStart} → ${wo.periodEnd} (+ ${wo.graceDays} grace days), days end at midnight ${wo.timeZone}`,
    ],
    [
      "Budget",
      `${formatTokenAmount(wo.budgetAmount, wo.tokenId)} cap · ${formatTokenAmount(wo.committedAmount, wo.tokenId)} committed · ${formatTokenAmount(wo.paidAmount, wo.tokenId)} paid · ${formatTokenAmount(wo.remainingAmount, wo.tokenId)} left`,
    ],
    [
      "Repositories",
      <ul key="r" className="flex flex-col gap-1">
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
                ? `Owner unknown: ${o.error}`
                : o.ownerType === "User"
                  ? `Owned by @${o.owner}, who accepts pull requests`
                  : `Owned by the organization ${o.owner}; accepted by its repo admins${o.approvers.length ? `: ${o.approvers.map((a) => `@${a}`).join(", ")}` : " (none found)"}`}
            </span>
          </li>
        ))}
      </ul>,
    ],
    ...(wo.scope ? ([["Authorized work", wo.scope]] as [string, React.ReactNode][]) : []),
    [
      "Terms",
      wo.acceptedAt
        ? `${wo.signature.method === "google_esign" ? "E-signed" : "Accepted by the builder"} on ${wo.acceptedAt.slice(0, 10)}${wo.termsChanged ? " (changed since)" : ""}`
        : wo.offeredAt
          ? `Offered on ${wo.offeredAt.slice(0, 10)}, waiting for the builder`
          : "Not offered yet",
    ],
    ...(wo.renewedFrom
      ? ([
          [
            "Renews",
            <Link
              key="p"
              to="/admin/work-orders/$id"
              params={{ id: wo.renewedFrom }}
              className="underline underline-offset-4"
            >
              the previous month's work order
            </Link>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Terms</h2>
        </CardTitle>
        <CardDescription>
          A contribution counts once the repository owner approves or merges its pull request on
          GitHub. The budget is a maximum, not a guarantee.
        </CardDescription>
        {wo.waiting > 0 && (
          <CardAction>
            <Badge>{wo.waiting} waiting</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function DocumentForm({ workOrder, onDone }: { workOrder: WorkOrderDetail; onDone: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [sha256, setSha256] = useState(workOrder.documentSha256 ?? "");
  const [url, setUrl] = useState(workOrder.documentUrl ?? "");
  const [hashing, setHashing] = useState(false);
  const valid = /^[0-9a-fA-F]{64}$/.test(sha256.trim());
  const save = useMutation({
    mutationFn: () =>
      apiClient.workOrders.attachDocument({
        id: workOrder.id,
        sha256: sha256.trim(),
        url: url.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success("Signed document recorded");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't record the document"),
  });
  const hashFile = async (file: File) => {
    setHashing(true);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      setSha256([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    } finally {
      setHashing(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Signed document</DialogTitle>
        <DialogDescription>
          Optional legal record. Pick the signed PDF to fingerprint it in your browser (the file
          isn't uploaded), and link where it's stored.
        </DialogDescription>
      </DialogHeader>
      <Field label="Signed PDF" htmlFor="doc-file">
        <Input
          id="doc-file"
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void hashFile(file);
          }}
        />
      </Field>
      <Field label="SHA-256" htmlFor="doc-sha" helper={hashing ? "Fingerprinting…" : undefined}>
        <Input
          id="doc-sha"
          className="font-mono text-xs"
          value={sha256}
          onChange={(e) => setSha256(e.target.value)}
        />
      </Field>
      <Field label="Link (optional)" htmlFor="doc-url">
        <Input id="doc-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={!valid || save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
