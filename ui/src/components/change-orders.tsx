import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { TokenSelect } from "@/components/admin/token-amount-fields";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, selectClass } from "@/components/admin-form";
import { TokenAmountCell } from "@/components/token-amounts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRefreshingMutation } from "@/hooks/use-refreshing-mutation";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import {
  amountUnit,
  type ChangeOrderItem,
  failureMessage,
  planChangeItems,
  signedBaseAmount,
} from "@/lib/change-orders";
import { baseToDecimal, formatTokenAmount, tokenDecimals } from "@/lib/format-amount";
import {
  allocationPlanQueryOptions,
  changeOrdersListQueryOptions,
  prepaidBalanceQueryOptions,
} from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";

export type ChangeOrderView = Awaited<
  ReturnType<ApiClient["changeOrders"]["list"]>
>["data"][number];

type ProjectOption = { id: string; title: string };

type Side = "agency" | "client";

export type ChangeOrdersPanelProps = {
  engagementId: string;
  side: Side;
  names: Record<Side, string>;
  projects: ProjectOption[];
  active: boolean;
  canManage: boolean;
};

const STATUS_VARIANT = {
  proposed: "accent",
  approved: "outline",
  applied: "outline",
  rejected: "secondary",
  withdrawn: "secondary",
  failed: "destructive",
} as const;

function useChangeOrderMutation<TInput>(
  action: (input: TInput) => Promise<ChangeOrderView>,
  success: (result: ChangeOrderView) => string,
) {
  return useRefreshingMutation({ type: "changeOrders" }, action, success, (result) =>
    result.status === "failed"
      ? `Not applied: ${failureMessage(result.failureReason ?? "")}`
      : undefined,
  );
}

function useTokenOptions(engagementId: string) {
  const apiClient = useApiClient();
  const balances = useQuery(prepaidBalanceQueryOptions(apiClient, engagementId)).data?.data ?? [];
  const plan = useQuery(allocationPlanQueryOptions(apiClient, engagementId)).data;
  return [
    ...new Set([
      "near",
      ...balances.map((b) => b.tokenId),
      ...(plan?.lines ?? []).map((l) => l.tokenId),
    ]),
  ].map((tokenId) => ({ tokenId, label: tokenDisplayName(tokenId) }));
}

function displayAmount(amount: string, tokenId: string): string {
  const decimals = tokenDecimals(tokenId);
  return decimals === undefined ? amount : baseToDecimal(amount, decimals);
}

export function ShortfallWarnings({
  engagementId,
  projects,
}: {
  engagementId: string;
  projects: ProjectOption[];
}) {
  const apiClient = useApiClient();
  const plan = useQuery(allocationPlanQueryOptions(apiClient, engagementId)).data;
  const titleOf = (id: string) => projects.find((p) => p.id === id)?.title ?? id;
  const short = (plan?.applications ?? []).filter((a) => a.shortfall.length > 0).slice(0, 3);
  if (short.length === 0) return null;
  return (
    <div className="space-y-2">
      {short.map((application) => (
        <Alert key={application.period} variant="destructive">
          <AlertTitle>The plan for {application.period} was not fully applied</AlertTitle>
          <AlertDescription>
            The Prepaid balance did not cover{" "}
            {application.shortfall
              .map(
                (line) =>
                  `${titleOf(line.projectId)} (${formatTokenAmount(line.amount, line.tokenId)})`,
              )
              .join(", ")}
            . Those lines were skipped.
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function AllocationPlanTable({
  engagementId,
  projects,
}: {
  engagementId: string;
  projects: ProjectOption[];
}) {
  const apiClient = useApiClient();
  const planQuery = useQuery(allocationPlanQueryOptions(apiClient, engagementId));
  if (planQuery.isError) return <AdminError error={planQuery.error} />;
  const plan = planQuery.data;
  if (!plan) return null;
  const titleOf = (id: string) => projects.find((p) => p.id === id)?.title ?? id;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Changes agreed now take effect from{" "}
        <span className="font-mono text-foreground">{plan.nextPeriod}</span>, the next month whose
        plan has not been applied.
      </p>
      {plan.lines.length === 0 ? (
        <Empty label="No Allocation plan yet. The Agency proposes the first one as a Change order." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>project</TableHead>
              <TableHead>per month</TableHead>
              <TableHead>from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.lines.map((line) => (
              <TableRow key={`${line.projectId}:${line.tokenId}`}>
                <TableCell>{titleOf(line.projectId)}</TableCell>
                <TableCell>
                  <TokenAmountCell amount={line.amount} tokenId={line.tokenId} />
                </TableCell>
                <TableCell className="font-mono text-xs">{line.effectiveFrom}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

type EditableLine = { projectId: string; tokenId: string; amount: string };

function PlanEditor({
  engagementId,
  projects,
}: {
  engagementId: string;
  projects: ProjectOption[];
}) {
  const apiClient = useApiClient();
  const plan = useQuery(allocationPlanQueryOptions(apiClient, engagementId)).data;
  const tokens = useTokenOptions(engagementId);
  const current = plan?.lines ?? [];
  const initial = current.map((l) => ({ ...l, amount: displayAmount(l.amount, l.tokenId) }));
  const [lines, setLines] = useState<EditableLine[] | null>(null);
  const [note, setNote] = useState("");
  const edited = lines ?? initial;

  const parsed = edited.map((line) => {
    const { value, error } =
      line.amount.trim() === "" || /^0*(\.0*)?$/.test(line.amount.trim())
        ? { value: "0", error: "" }
        : signedBaseAmount(line.amount, tokenDecimals(line.tokenId));
    return { ...line, base: value, error: error || (value.startsWith("-") ? "Not negative." : "") };
  });
  const invalid = parsed.some((l) => l.error || !l.projectId);
  const items = invalid
    ? []
    : planChangeItems(
        current,
        parsed.map((l) => ({ projectId: l.projectId, tokenId: l.tokenId, amount: l.base })),
      );

  const propose = useChangeOrderMutation(
    () =>
      apiClient.changeOrders.propose({
        engagementId,
        effective: "next_period",
        note: note.trim() || undefined,
        items,
      }),
    () => "Plan change proposed",
  );

  const update = (index: number, patch: Partial<EditableLine>) =>
    setLines(edited.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display text-lg uppercase font-extrabold">Edit the plan</h3>
          <p className="text-sm text-muted-foreground">
            Set the amount per month for each Project. Saving proposes a Change order; it applies
            once the other side approves it, from the next month's Prepayment.
          </p>
        </div>
        <div className="space-y-3">
          {parsed.map((line, index) => (
            <div
              key={`${index}-${line.projectId}`}
              className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
            >
              <Field label="project" htmlFor={`plan-project-${index}`}>
                <select
                  id={`plan-project-${index}`}
                  value={line.projectId}
                  onChange={(e) => update(index, { projectId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">choose a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="token" htmlFor={`plan-token-${index}`}>
                <TokenSelect
                  id={`plan-token-${index}`}
                  value={line.tokenId}
                  options={tokens}
                  onChange={(tokenId) => update(index, { tokenId })}
                />
              </Field>
              <Field
                label={`per month (${amountUnit(line.tokenId)})`}
                htmlFor={`plan-amount-${index}`}
              >
                <Input
                  id={`plan-amount-${index}`}
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) => update(index, { amount: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLines(edited.filter((_, i) => i !== index))}
              >
                remove
              </Button>
              {line.error && <p className="text-xs text-destructive sm:col-span-4">{line.error}</p>}
            </div>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines([...edited, { projectId: "", tokenId: "near", amount: "" }])}
        >
          add a project
        </Button>
        <Field label="note (optional)" htmlFor="plan-note">
          <Input id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button
          size="sm"
          disabled={items.length === 0 || propose.isPending}
          onClick={() =>
            propose.mutate(undefined, {
              onSuccess: () => {
                setLines(null);
                setNote("");
              },
            })
          }
        >
          propose plan change
        </Button>
      </CardContent>
    </Card>
  );
}

type MoveRow = { target: string; tokenId: string; amount: string };

function MoveForm({ engagementId, projects }: { engagementId: string; projects: ProjectOption[] }) {
  const apiClient = useApiClient();
  const tokens = useTokenOptions(engagementId);
  const [rows, setRows] = useState<MoveRow[]>([{ target: "", tokenId: "near", amount: "" }]);
  const [effective, setEffective] = useState<"now" | "next_period">("next_period");
  const [note, setNote] = useState("");

  const parsed = rows.map((row) => ({
    ...row,
    ...signedBaseAmount(row.amount, tokenDecimals(row.tokenId)),
  }));
  const invalid = parsed.some((r) => r.error || !r.target || r.value === "");
  const moves: ChangeOrderItem[] = invalid
    ? []
    : parsed.map((r) => ({
        projectId: r.target,
        tokenId: r.tokenId,
        kind: "one_off_move",
        amount: r.value,
      }));

  const propose = useChangeOrderMutation(
    () =>
      apiClient.changeOrders.propose({
        engagementId,
        effective,
        note: note.trim() || undefined,
        items: moves,
      }),
    () => "Change order proposed",
  );

  const update = (index: number, patch: Partial<MoveRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-1">
          <h3 className="font-display text-lg uppercase font-extrabold">Move budget</h3>
          <p className="text-sm text-muted-foreground">
            A positive amount puts Prepaid balance into a Project; a negative one pulls unspent
            budget back. Pull-backs cannot exceed what this Engagement put into the Project or what
            is not yet Allocated, Committed or Paid there.
          </p>
        </div>
        {parsed.map((row, index) => (
          <div
            key={`${index}-${row.target}`}
            className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          >
            <Field label="where" htmlFor={`move-target-${index}`}>
              <select
                id={`move-target-${index}`}
                value={row.target}
                onChange={(e) => update(index, { target: e.target.value })}
                className={selectClass}
              >
                <option value="">choose</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="token" htmlFor={`move-token-${index}`}>
              <TokenSelect
                id={`move-token-${index}`}
                value={row.tokenId}
                options={tokens}
                onChange={(tokenId) => update(index, { tokenId })}
              />
            </Field>
            <Field
              label={`amount in ${amountUnit(row.tokenId)} (+ in, − out)`}
              htmlFor={`move-amount-${index}`}
            >
              <Input
                id={`move-amount-${index}`}
                inputMode="decimal"
                value={row.amount}
                onChange={(e) => update(index, { amount: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              remove
            </Button>
            {row.error && <p className="text-xs text-destructive sm:col-span-4">{row.error}</p>}
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows([...rows, { target: "", tokenId: "near", amount: "" }])}
        >
          add a line
        </Button>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="takes effect" htmlFor="move-effective">
            <select
              id="move-effective"
              value={effective}
              onChange={(e) => setEffective(e.target.value === "now" ? "now" : "next_period")}
              className={selectClass}
            >
              <option value="next_period">with next month's Prepayment</option>
              <option value="now">right away, once approved</option>
            </select>
          </Field>
          <Field label="note (optional)" htmlFor="move-note">
            <Input id="move-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button
          size="sm"
          disabled={moves.length === 0 || propose.isPending}
          onClick={() =>
            propose.mutate(undefined, {
              onSuccess: () => {
                setRows([{ target: "", tokenId: "near", amount: "" }]);
                setNote("");
              },
            })
          }
        >
          propose change order
        </Button>
      </CardContent>
    </Card>
  );
}

function statusLine(changeOrder: ChangeOrderView): string {
  switch (changeOrder.status) {
    case "proposed":
      return changeOrder.effective === "now"
        ? "Applies right away once approved."
        : "Applies with the next month's Prepayment once approved.";
    case "approved":
      return `Approved. Applies with the Prepayment for ${changeOrder.effectivePeriod}.`;
    case "applied":
      return changeOrder.items.some((i) => i.kind === "plan_change")
        ? `Applied. Plan changes count from ${changeOrder.effectivePeriod}.`
        : "Applied.";
    case "failed":
      return `Not applied. ${failureMessage(changeOrder.failureReason ?? "")}`;
    case "rejected":
      return "Rejected.";
    case "withdrawn":
      return "Withdrawn.";
  }
}

function ChangeOrderCard({
  changeOrder,
  names,
  projects,
}: {
  changeOrder: ChangeOrderView;
  names: Record<Side, string>;
  projects: ProjectOption[];
}) {
  const apiClient = useApiClient();
  const titleOf = (id: string | null) =>
    id === null ? "Prepaid balance" : (projects.find((p) => p.id === id)?.title ?? id);
  const approve = useChangeOrderMutation(
    () => apiClient.changeOrders.approve({ id: changeOrder.id }),
    (result) => (result.status === "applied" ? "Approved and applied" : "Approved"),
  );
  const reject = useChangeOrderMutation(
    () => apiClient.changeOrders.reject({ id: changeOrder.id }),
    () => "Rejected",
  );
  const withdraw = useChangeOrderMutation(
    () => apiClient.changeOrders.withdraw({ id: changeOrder.id }),
    () => "Withdrawn",
  );
  const busy = approve.isPending || reject.isPending || withdraw.isPending;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[changeOrder.status]}>{changeOrder.status}</Badge>
            <span className="text-sm">
              proposed by {names[changeOrder.proposedBy.side]} on{" "}
              {new Date(changeOrder.createdAt).toISOString().slice(0, 10)}
            </span>
          </div>
          {(changeOrder.canDecide || changeOrder.canWithdraw) && (
            <div className="flex gap-2">
              {changeOrder.canDecide && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => approve.mutate(undefined)}>
                    approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => reject.mutate(undefined)}
                  >
                    reject
                  </Button>
                </>
              )}
              {changeOrder.canWithdraw && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => withdraw.mutate(undefined)}
                >
                  withdraw
                </Button>
              )}
            </div>
          )}
        </div>
        {changeOrder.note && <p className="text-sm">{changeOrder.note}</p>}
        <ul className="space-y-1 text-sm">
          {changeOrder.items.map((item, index) => (
            <li key={`${index}-${item.projectId}`} className="flex flex-wrap gap-2">
              <span className="text-muted-foreground">
                {item.kind === "plan_change" ? "plan per month" : "move"}
              </span>
              <span>{titleOf(item.projectId)}</span>
              <span className="font-mono text-xs">
                {BigInt(item.amount) > 0n ? "+" : ""}
                {formatTokenAmount(item.amount, item.tokenId)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{statusLine(changeOrder)}</p>
      </CardContent>
    </Card>
  );
}

export function ChangeOrderHistory({
  engagementId,
  names,
  projects,
  pending,
}: {
  engagementId: string;
  names: Record<Side, string>;
  projects: ProjectOption[];
  pending: boolean;
}) {
  const apiClient = useApiClient();
  const listQuery = useQuery(changeOrdersListQueryOptions(apiClient, engagementId));
  if (listQuery.isError) return <AdminError error={listQuery.error} />;
  const all = listQuery.data?.data ?? [];
  const shown = all.filter((c) => (c.status === "proposed" || c.status === "approved") === pending);
  if (listQuery.isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (shown.length === 0) {
    return <Empty label={pending ? "Nothing pending." : "No decided Change orders yet."} />;
  }
  return (
    <div className="space-y-2">
      {shown.map((changeOrder) => (
        <ChangeOrderCard
          key={changeOrder.id}
          changeOrder={changeOrder}
          names={names}
          projects={projects}
        />
      ))}
    </div>
  );
}

export function ChangeOrdersPanel({
  engagementId,
  side,
  names,
  projects,
  active,
  canManage,
}: ChangeOrdersPanelProps) {
  const other = side === "agency" ? "client" : "agency";
  return (
    <div className="space-y-8">
      <ShortfallWarnings engagementId={engagementId} projects={projects} />
      <section className="space-y-3">
        <h2 className="font-display text-xl uppercase font-extrabold">Allocation plan</h2>
        <AllocationPlanTable engagementId={engagementId} projects={projects} />
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-xl uppercase font-extrabold">Pending</h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          A Change order is decided by an owner or admin of the side that did not propose it:{" "}
          {names[other]} decides yours, you decide theirs.
        </p>
        <ChangeOrderHistory engagementId={engagementId} names={names} projects={projects} pending />
      </section>
      {active && canManage && (
        <section className="grid gap-4 lg:grid-cols-2">
          <PlanEditor engagementId={engagementId} projects={projects} />
          <MoveForm engagementId={engagementId} projects={projects} />
        </section>
      )}
      {active && !canManage && (
        <p className="text-sm text-muted-foreground">
          Only owners and admins propose and decide Change orders. You can follow everything here.
        </p>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-xl uppercase font-extrabold">History</h2>
        <ChangeOrderHistory
          engagementId={engagementId}
          names={names}
          projects={projects}
          pending={false}
        />
      </section>
    </div>
  );
}
