import { DotsThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
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
  ScrollableTabsList,
  Tabs,
  TabsContent,
  TabsTrigger,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActivityTimeline } from "@/components/work-orders/activity-timeline";
import { EvidenceList } from "@/components/work-orders/evidence-list";
import { type InPageAction, NextStepCard } from "@/components/work-orders/next-step-card";
import { PayeePayoutsPrompt } from "@/components/work-orders/payee-payouts-prompt";
import { PayoutCoveragePrompt } from "@/components/work-orders/payout-coverage-prompt";
import { ProgressStepper } from "@/components/work-orders/progress-stepper";
import { RenewalPanel } from "@/components/work-orders/renewal-panel";
import { RequestsPanel } from "@/components/work-orders/requests-panel";
import { SigningPanel } from "@/components/work-orders/signing-panel";
import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { WorkOrderKeyFacts } from "@/components/work-orders/work-order-key-facts";
import {
  RenewalBadge,
  signedHow,
  type WorkOrderDetail,
  WorkOrderStatusBadge,
} from "@/components/work-orders/work-order-status";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { dateTime } from "@/lib/format-date";
import { warnIfPayoutsUncovered } from "@/lib/payout-coverage";
import { adminWorkOrderQueryOptions, adminWorkOrdersQueryKey } from "@/lib/queries";

const WORK_ORDER_TABS = ["overview", "payouts", "documents"] as const;
type WorkOrderTab = (typeof WORK_ORDER_TABS)[number];

const LEGACY_TABS: Record<string, WorkOrderTab> = {
  evidence: "documents",
  activity: "overview",
};

function workOrderTabOf(value: unknown): WorkOrderTab | undefined {
  if (typeof value !== "string") return undefined;
  if ((WORK_ORDER_TABS as readonly string[]).includes(value)) return value as WorkOrderTab;
  return LEGACY_TABS[value];
}

export const Route = createFileRoute("/_authenticated/admin/work-orders/$id")({
  head: () => ({ meta: [{ title: "Work order" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: WorkOrderTab } => ({
    tab: workOrderTabOf(search.tab),
  }),
  component: WorkOrderPage,
});

type Action = "offer" | "activate" | "terminate" | "delete" | "collect";

function defaultTab(stage: WorkOrderDetail["progress"]["stage"]): WorkOrderTab {
  if (stage === "request" || stage === "approved" || stage === "paid") return "payouts";
  if (stage === "draft" || stage === "agency_signs" || stage === "builder_signs") {
    return "documents";
  }
  return "overview";
}

function WorkOrderPage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { canAccessAdmin: canManage, agencyDao } = useMeRoles();
  const query = useQuery(adminWorkOrderQueryOptions(apiClient, id));
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<null | "terminate" | "delete">(null);
  const [documenting, setDocumenting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [approveRequestId, setApproveRequestId] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const clearApprove = useCallback(() => setApproveRequestId(null), []);

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
      if (action === "offer") await warnIfPayoutsUncovered(queryClient, apiClient, id);
    },
    onError: (err: Error) => toast.error(err.message || "Something went wrong"),
  });

  const stage = query.data?.progress.stage;
  const activeTab: WorkOrderTab = tab ?? (stage ? defaultTab(stage) : "overview");
  const selectTab = useCallback(
    (value: WorkOrderTab) => {
      void routeNavigate({ search: { tab: value }, replace: true, resetScroll: false });
    },
    [routeNavigate],
  );

  useEffect(() => {
    if (!scrollTo || typeof document === "undefined") return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollTo(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTo]);

  if (query.isError) return <AdminError error={query.error} />;
  if (!query.data) return <Loading label="Loading the work order" />;
  const wo = query.data;
  const { progress } = wo;
  const editable = canManage && ["draft", "offered", "accepted"].includes(wo.status);
  const payable = ["active", "ended", "exhausted"].includes(wo.status);
  const deletable = wo.status === "draft" || wo.status === "offered";
  const terminable = wo.status !== "draft" && wo.status !== "terminated";
  const nextKind = progress.next?.kind ?? null;
  const showOffer = wo.status === "draft" && nextKind !== "offer";
  const showActivate = wo.status === "accepted" && nextKind !== "activate";
  const blocked = act.isPending || wo.activationBlockers.length > 0;

  const onAction = (action: InPageAction) => {
    if (action.kind === "offer") act.mutate("offer");
    else if (action.kind === "activate") act.mutate("activate");
    else if (action.kind === "edit") setEditing(true);
    else if (action.kind === "approve" || action.kind === "pay") {
      selectTab("payouts");
      setApproveRequestId(action.requestId);
    } else if (action.kind === "renewal") {
      selectTab("overview");
      setScrollTo("work-order-renewal");
    }
  };

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
              {editable && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label="More actions">
                    <DotsThreeIcon weight="bold" aria-hidden />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {showOffer && (
                    <DropdownMenuItem disabled={act.isPending} onSelect={() => act.mutate("offer")}>
                      Offer to the builder
                    </DropdownMenuItem>
                  )}
                  {showActivate && (
                    <DropdownMenuItem disabled={blocked} onSelect={() => act.mutate("activate")}>
                      Activate now
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setDuplicating(true)}>
                    Duplicate
                  </DropdownMenuItem>
                  {(deletable || terminable) && <DropdownMenuSeparator />}
                  {deletable && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirming("delete")}
                    >
                      {wo.status === "offered" ? "Withdraw and delete" : "Delete"}
                    </DropdownMenuItem>
                  )}
                  {terminable && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setConfirming("terminate")}
                    >
                      Terminate
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />

      <WorkOrderKeyFacts workOrder={wo} />

      <ProgressStepper progress={progress} />

      <NextStepCard
        progress={progress}
        builderName={wo.builder.name ?? wo.builder.nearAccount}
        canManage={canManage}
        busy={act.isPending}
        onAction={onAction}
      >
        {canManage && <PayeePayoutsPrompt workOrder={wo} />}
        {canManage && <PayoutCoveragePrompt workOrder={wo} />}
      </NextStepCard>

      <Tabs value={activeTab} onValueChange={(value) => selectTab(value as WorkOrderTab)}>
        <ScrollableTabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payouts">
            Payouts
            {wo.waiting > 0 && <Badge className="ml-1">{wo.waiting}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </ScrollableTabsList>

        <TabsContent value="overview" className="flex flex-col gap-6">
          <Summary workOrder={wo} />
          <div id="work-order-renewal" className="scroll-mt-4 empty:hidden">
            <RenewalPanel workOrder={wo} canManage={canManage} />
          </div>
          <ActivityTimeline workOrder={wo} />
        </TabsContent>

        <TabsContent value="payouts" className="flex flex-col gap-6">
          {payable || wo.requests.length > 0 ? (
            <RequestsPanel
              workOrder={wo}
              canManage={canManage}
              hasTreasury={agencyDao !== null}
              approveRequestId={approveRequestId}
              onApproveOpened={clearApprove}
            />
          ) : (
            <Card>
              <CardContent>
                <Empty
                  label="No payouts yet."
                  description="They start once the work order is active."
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents" className="flex flex-col gap-6">
          <SigningPanel
            workOrder={wo}
            canManage={canManage}
            onAttach={() => setDocumenting(true)}
          />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Evidence</h2>
              </CardTitle>
              <CardDescription>
                {wo.lastCollectedAt
                  ? `From GitHub, last collected ${dateTime(wo.lastCollectedAt)}.`
                  : "Collected from GitHub once the work order is active."}
              </CardDescription>
              {canManage && payable && (
                <CardAction>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.isPending}
                    onClick={() => act.mutate("collect")}
                  >
                    Collect now
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              <EvidenceList evidence={wo.evidence} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          {editing && <WorkOrderForm editing={wo} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={duplicating} onOpenChange={setDuplicating}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
        >
          {duplicating && (
            <WorkOrderForm
              template={wo}
              onDone={(created) => {
                setDuplicating(false);
                void navigate({ to: "/admin/work-orders/$id", params: { id: created.id } });
              }}
            />
          )}
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
        title={
          confirming === "delete"
            ? wo.status === "offered"
              ? `Withdraw and delete ${wo.code}?`
              : `Delete ${wo.code}?`
            : `Terminate ${wo.code}?`
        }
        description={
          confirming === "delete"
            ? wo.status === "offered"
              ? `It was already sent to ${wo.builder.name ?? wo.builder.nearAccount}; their signing link stops working and the record is removed.`
              : "The draft is removed. The builder hasn't started work under it."
            : wo.status === "offered"
              ? `The offer is withdrawn: ${wo.builder.name ?? wo.builder.nearAccount}'s signing link stops working. The record is kept as terminated, and nothing can be approved or paid under it.`
              : "Nothing more can be approved or paid under it. Requests already linked to a DAO proposal keep their billing."
        }
        confirmLabel={
          confirming === "delete"
            ? wo.status === "offered"
              ? "Withdraw and delete"
              : "Delete"
            : "Terminate"
        }
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
      "Schedule",
      `${wo.graceDays} grace ${wo.graceDays === 1 ? "day" : "days"} after ${wo.periodEnd}; days end at midnight ${wo.timeZone}`,
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
    ...(wo.ipModel
      ? ([["IP model", wo.ipModel.replace("_", " ")]] as [string, React.ReactNode][])
      : []),
    [
      "Terms",
      wo.acceptedAt
        ? `${wo.signature.method ? signedHow(wo.signature.method) : "Accepted by the builder"} on ${wo.acceptedAt.slice(0, 10)}${wo.termsChanged ? " (changed since)" : ""}`
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
          Work counts once the repo owner approves or merges it. The budget is a cap, not a
          guarantee.
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
          Optional. The PDF is fingerprinted in your browser, not uploaded.
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
