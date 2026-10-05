import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import type { ColumnDef } from "@/components/ui/data-table";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { baseToDecimal, formatTokenAmount, parseDecimalToBase } from "@/lib/format-amount";
import {
  adminProjectsListQueryOptions,
  tokensListQueryOptions,
  uncoveredPayoutsQueryOptions,
  workOrdersQueryKey,
  workOrdersQueryOptions,
} from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/work-orders")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
    if (session?.user?.role !== "admin") throw redirect({ to: "/admin" });
  },
  head: () => ({ meta: [{ title: "Work orders | Admin" }] }),
  component: WorkOrdersPage,
});

type WorkOrder = Awaited<ReturnType<ApiClient["workOrders"]["list"]>>["data"][number];
type Status = WorkOrder["status"];
type Warning = WorkOrder["warnings"][number];
type DraftLine = { projectId: string; tokenId: string; amount: string };

const STATUSES: Status[] = ["draft", "signed", "completed", "terminated"];

const WARNING_LABEL: Record<Warning, string> = {
  overpaid: "Paid beyond the amount",
  overBudget: "Exceeds Project budget",
  endingSoon: "Ending soon",
  noAgreement: "No agreement on file",
};

function WarningBadges({ warnings }: { warnings: Warning[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {warnings.map((w) => (
        <Badge key={w} variant="destructive">
          {WARNING_LABEL[w]}
        </Badge>
      ))}
    </div>
  );
}

function WorkOrdersPage() {
  const apiClient = useApiClient();
  const ordersQuery = useQuery(workOrdersQueryOptions(apiClient));
  const uncoveredQuery = useQuery(uncoveredPayoutsQueryOptions(apiClient));
  const [editing, setEditing] = useState<WorkOrder | "new" | null>(null);
  const orders = ordersQuery.data?.data ?? [];
  const uncovered = uncoveredQuery.data?.data ?? [];

  const columns: ColumnDef<WorkOrder>[] = [
    {
      id: "nearAccount",
      header: "Contributor",
      accessorKey: "nearAccount",
      cell: ({ row }) => <span className="font-medium">{row.original.nearAccount}</span>,
    },
    {
      id: "period",
      header: "Period",
      accessorFn: (row) => row.startsOn,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {row.original.startsOn} → {row.original.endsOn}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
    {
      id: "lines",
      header: "Projects · paid of amount",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          {row.original.lines.map((line) => (
            <span key={`${line.projectId}:${line.tokenId}`} className="text-sm">
              {line.projectTitle ?? line.projectId} ·{" "}
              <span className="tabular-nums">
                {formatTokenAmount(line.paid, line.tokenId)} of{" "}
                {formatTokenAmount(line.amount, line.tokenId)}
              </span>
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "warnings",
      header: "Warnings",
      enableSorting: false,
      cell: ({ row }) => <WarningBadges warnings={row.original.warnings} />,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditing(row.original)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work orders"
        description="Who is contracted, for how much and over what period, with what has been paid so far. Visible to platform admins only."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" aria-hidden />
            New work order
          </Button>
        }
      />

      {editing && (
        <WorkOrderForm
          key={editing === "new" ? "new" : editing.id}
          existing={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Work orders</h2>
          </CardTitle>
          <CardDescription>
            Paid so far counts this Agency's approved payouts to any of the contributor's accounts,
            from the start date until the work order is completed or terminated.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{orders.length}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {ordersQuery.isError ? (
            <LoadError
              title="Could not load work orders"
              description={ordersQuery.error?.message || "Check your connection and try again."}
              onRetry={() => void ordersQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={columns}
              data={orders}
              isLoading={ordersQuery.isLoading}
              emptyMessage="No work orders yet."
              searchPlaceholder="Search work orders…"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Payouts with no work order</h2>
          </CardTitle>
          <CardDescription>
            Approved payouts from the last 180 days that no signed, completed or terminated work
            order covers.
          </CardDescription>
          {uncoveredQuery.data && (
            <CardAction>
              <Badge variant={uncovered.length ? "destructive" : "secondary"}>
                {uncovered.length}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {uncoveredQuery.isError ? (
            <LoadError
              title="Could not load payouts"
              description={uncoveredQuery.error?.message || "Check your connection and try again."}
              onRetry={() => void uncoveredQuery.refetch()}
            />
          ) : !uncoveredQuery.data ? (
            <p className="text-sm text-muted-foreground">Loading payouts…</p>
          ) : uncovered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every recent payout is covered.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {uncovered.map((p) => (
                <li key={p.billingId} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {p.nearAccount ?? "Unknown account"} · {p.projectTitle ?? p.projectId}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatTokenAmount(p.amount, p.tokenId)} · {p.recordedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type FormProps = { existing: WorkOrder | null; onDone: () => void };

function WorkOrderForm(props: FormProps) {
  const apiClient = useApiClient();
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  if (!projectsQuery.data || !tokensQuery.data) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading Projects and tokens…</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <WorkOrderFormBody
      {...props}
      projects={projectsQuery.data.data}
      tokens={tokensQuery.data.tokens}
    />
  );
}

type Project = Awaited<ReturnType<ApiClient["agency"]["projects"]["listOwned"]>>["data"][number];
type Token = Awaited<ReturnType<ApiClient["tokens"]["list"]>>["tokens"][number];

function WorkOrderFormBody({
  existing,
  onDone,
  projects,
  tokens,
}: FormProps & { projects: Project[]; tokens: Token[] }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const decimalsOf = (tokenId: string) => tokens.find((t) => t.tokenId === tokenId)?.decimals;

  const [nearAccount, setNearAccount] = useState(existing?.nearAccount ?? "");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [status, setStatus] = useState<Status>(existing?.status ?? "draft");
  const [documentUrl, setDocumentUrl] = useState(existing?.documentUrl ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    existing?.lines.map((l) => {
      const decimals = decimalsOf(l.tokenId);
      return {
        projectId: l.projectId,
        tokenId: l.tokenId,
        amount: decimals === undefined ? l.amount : baseToDecimal(l.amount, decimals),
      };
    }) ?? [{ projectId: "", tokenId: "", amount: "" }],
  );

  const setLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        nearAccount: nearAccount.trim(),
        status,
        startsOn,
        endsOn,
        documentUrl: documentUrl.trim() || null,
        lines: lines.map((l) => {
          const decimals = decimalsOf(l.tokenId);
          if (decimals === undefined) throw new Error(`Unknown token ${l.tokenId}`);
          return {
            projectId: l.projectId,
            tokenId: l.tokenId,
            amount: parseDecimalToBase(l.amount, decimals),
          };
        }),
      };
      return existing
        ? apiClient.workOrders.update({ id: existing.id, ...body })
        : apiClient.workOrders.create(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workOrdersQueryKey });
      toast.success(existing ? "Work order saved" : "Work order created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save the work order"),
  });

  const removeMutation = useMutation({
    mutationFn: async () => apiClient.workOrders.remove({ id: existing!.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workOrdersQueryKey });
      toast.success("Draft deleted");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete the draft"),
  });

  const canSubmit =
    nearAccount.trim() !== "" &&
    startsOn !== "" &&
    endsOn !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.projectId && l.tokenId && l.amount.trim());
  const isPending = saveMutation.isPending || removeMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{existing ? "Edit work order" : "New work order"}</h2>
        </CardTitle>
        <CardDescription>
          One line per Project and token. Amounts and the document link are private to platform
          admins.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !isPending) saveMutation.mutate();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field>
                <FieldLabel htmlFor="wo-account">Contributor NEAR account</FieldLabel>
                <Input
                  id="wo-account"
                  value={nearAccount}
                  onChange={(e) => setNearAccount(e.target.value)}
                  placeholder="builder.near"
                  disabled={isPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="wo-status">Status</FieldLabel>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger id="wo-status" disabled={isPending}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.filter(
                      (s) => s !== "draft" || !existing || existing.status === "draft",
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="wo-start">Starts on</FieldLabel>
                <Input
                  id="wo-start"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="wo-end">Ends on</FieldLabel>
                <Input
                  id="wo-end"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                  disabled={isPending}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="wo-document">Signed document link</FieldLabel>
              <Input
                id="wo-document"
                type="url"
                value={documentUrl}
                onChange={(e) => setDocumentUrl(e.target.value)}
                placeholder="https://"
                disabled={isPending}
              />
            </Field>
            {lines.map((line, index) => (
              <div
                key={`line-${index.toString()}`}
                className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
              >
                <Field>
                  <FieldLabel htmlFor={`wo-project-${index}`}>Project</FieldLabel>
                  <Select
                    value={line.projectId}
                    onValueChange={(v) => setLine(index, { projectId: v })}
                  >
                    <SelectTrigger id={`wo-project-${index}`} disabled={isPending}>
                      <SelectValue placeholder="Choose a Project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title} {p.kind !== "project" ? `(${p.kind})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`wo-token-${index}`}>Token</FieldLabel>
                  <Select
                    value={line.tokenId}
                    onValueChange={(v) => setLine(index, { tokenId: v })}
                  >
                    <SelectTrigger id={`wo-token-${index}`} disabled={isPending}>
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {tokens.map((t) => (
                        <SelectItem key={t.tokenId} value={t.tokenId}>
                          {t.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`wo-amount-${index}`}>Amount</FieldLabel>
                  <Input
                    id={`wo-amount-${index}`}
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => setLine(index, { amount: e.target.value })}
                    placeholder="0.00"
                    disabled={isPending}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={isPending || lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={isPending}
              onClick={() =>
                setLines((current) => [...current, { projectId: "", tokenId: "", amount: "" }])
              }
            >
              <PlusIcon data-icon="inline-start" aria-hidden />
              Add a Project
            </Button>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <div>
            {existing?.status === "draft" && (
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => removeMutation.mutate()}
              >
                Delete draft
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {saveMutation.isPending ? "Saving…" : "Save work order"}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
