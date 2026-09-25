import { ArrowsLeftRightIcon, CaretRightIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { TokenSelect } from "@/components/admin/token-amount-fields";
import { AdminError } from "@/components/admin-error";
import { TokenAmountCell } from "@/components/token-amounts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  type ChangeOrderItem,
  failureMessage,
  planChangeItems,
  signedBaseAmount,
} from "@/lib/change-orders";
import { baseToDecimal, formatTokenAmount, tokenDecimals, tokenSymbol } from "@/lib/format-amount";
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

type TokenOption = { tokenId: string; label: string };

export type ChangeOrdersPanelProps = {
  engagementId: string;
  side: Side;
  names: Record<Side, string>;
  projects: ProjectOption[];
  active: boolean;
  canManage: boolean;
};

const STATUS_BADGE: Record<
  ChangeOrderView["status"],
  { label: string; variant: "default" | "outline" | "secondary" | "destructive" }
> = {
  proposed: { label: "Proposed", variant: "default" },
  approved: { label: "Approved", variant: "outline" },
  applied: { label: "Applied", variant: "outline" },
  rejected: { label: "Rejected", variant: "secondary" },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};

export function ChangeOrderStatusBadge({ status }: { status: ChangeOrderView["status"] }) {
  const { label, variant } = STATUS_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const ROW_GRID = "grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_11rem_2rem] sm:items-start";
const MOVE_ROW_GRID = "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_8rem_11rem_2rem] sm:items-start";
const COLUMN_LABEL = "sm:sr-only";

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

function useTokenOptions(engagementId: string): TokenOption[] {
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

function unitOf(tokenId: string): string {
  return tokenDecimals(tokenId) === undefined ? "units" : tokenSymbol(tokenId);
}

function formatDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
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
    <div className="flex flex-col gap-2">
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
            , so those lines were skipped.
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function AllocationPlanCard({
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
  const titleOf = (id: string) => projects.find((p) => p.id === id)?.title ?? id;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Allocation plan</CardTitle>
        <CardDescription>
          {plan
            ? `The amount each Project gets every month. Changes agreed now take effect from ${plan.nextPeriod}.`
            : "The amount each Project gets every month."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!plan ? (
          <ListSkeleton />
        ) : plan.lines.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArrowsLeftRightIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No plan yet</EmptyTitle>
              <EmptyDescription>
                The Agency proposes the first plan as a Change order.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Per month</TableHead>
                <TableHead>From</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.lines.map((line) => (
                <TableRow key={`${line.projectId}:${line.tokenId}`}>
                  <TableCell className="whitespace-normal">{titleOf(line.projectId)}</TableCell>
                  <TableCell>
                    <TokenAmountCell amount={line.amount} tokenId={line.tokenId} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.effectiveFrom}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectSelect({
  id,
  value,
  projects,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  projects: ProjectOption[];
  onChange: (projectId: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AmountInput({
  id,
  value,
  tokenId,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  tokenId: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        placeholder="0"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <InputGroupAddon align="inline-end">{unitOf(tokenId)}</InputGroupAddon>
    </InputGroup>
  );
}

function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" size="icon" variant="ghost" aria-label={label} onClick={onClick}>
      <TrashIcon aria-hidden />
    </Button>
  );
}

function ColumnHeaders({ className, labels }: { className: string; labels: string[] }) {
  return (
    <div
      aria-hidden
      className={`hidden text-xs font-medium text-muted-foreground sm:grid ${className}`}
    >
      {labels.map((label, index) => (
        <span key={`${index}-${label}`}>{label}</span>
      ))}
    </div>
  );
}

function EditorFooter({ reason, children }: { reason: string | null; children: ReactNode }) {
  return (
    <CardFooter className="flex-wrap justify-end gap-3">
      {reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
      {children}
    </CardFooter>
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
    return {
      ...line,
      base: value,
      error: error || (value.startsWith("-") ? "Enter a positive amount." : ""),
    };
  });
  const missingProject = parsed.some((l) => !l.projectId);
  const badAmount = parsed.some((l) => l.error);
  const items =
    missingProject || badAmount
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
  const addLine = () => setLines([...edited, { projectId: "", tokenId: "near", amount: "" }]);

  const reason = missingProject
    ? "Choose a Project for every line."
    : badAmount
      ? "Fix the amounts marked in red."
      : items.length === 0
        ? edited.length === 0
          ? "Add at least one Project."
          : "Change an amount to propose a plan change."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit the plan</CardTitle>
        <CardDescription>
          Set the monthly amount per Project. It applies from the next month once the other side
          approves.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {parsed.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyTitle>{current.length === 0 ? "No plan yet" : "Every line removed"}</EmptyTitle>
              <EmptyDescription>
                {current.length === 0
                  ? "Add a Project and its monthly amount to start the plan."
                  : "Proposing now would stop every monthly amount."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={addLine}>
                <PlusIcon data-icon="inline-start" aria-hidden />
                Add a Project
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <ColumnHeaders className={ROW_GRID} labels={["Project", "Token", "Per month", ""]} />
            {parsed.map((line, index) => (
              <div
                key={`${index}-${line.projectId}`}
                className={`${ROW_GRID} border-b pb-3 last:border-b-0 last:pb-0 sm:border-b-0 sm:pb-0`}
              >
                <Field>
                  <FieldLabel htmlFor={`plan-project-${index}`} className={COLUMN_LABEL}>
                    Project
                  </FieldLabel>
                  <ProjectSelect
                    id={`plan-project-${index}`}
                    value={line.projectId}
                    projects={projects}
                    placeholder="Choose a Project"
                    onChange={(projectId) => update(index, { projectId })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`plan-token-${index}`} className={COLUMN_LABEL}>
                    Token
                  </FieldLabel>
                  <TokenSelect
                    id={`plan-token-${index}`}
                    value={line.tokenId}
                    options={tokens}
                    onChange={(tokenId) => update(index, { tokenId })}
                  />
                </Field>
                <Field data-invalid={line.error ? true : undefined}>
                  <FieldLabel htmlFor={`plan-amount-${index}`} className={COLUMN_LABEL}>
                    Per month
                  </FieldLabel>
                  <AmountInput
                    id={`plan-amount-${index}`}
                    value={line.amount}
                    tokenId={line.tokenId}
                    invalid={Boolean(line.error)}
                    onChange={(amount) => update(index, { amount })}
                  />
                  {line.error && <FieldError>{line.error}</FieldError>}
                </Field>
                <div className="flex justify-end">
                  <RemoveRowButton
                    label={`Remove line ${index + 1}`}
                    onClick={() => setLines(edited.filter((_, i) => i !== index))}
                  />
                </div>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" onClick={addLine}>
                <PlusIcon data-icon="inline-start" aria-hidden />
                Add a Project
              </Button>
            </div>
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="plan-note">Note (optional)</FieldLabel>
          <Input id="plan-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </CardContent>
      <EditorFooter reason={reason}>
        <Button
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
          {propose.isPending ? "Proposing…" : "Propose plan change"}
        </Button>
      </EditorFooter>
    </Card>
  );
}

type Direction = "in" | "out";

type MoveRow = { target: string; direction: Direction; tokenId: string; amount: string };

const EMPTY_MOVE: MoveRow = { target: "", direction: "in", tokenId: "near", amount: "" };

function MoveForm({ engagementId, projects }: { engagementId: string; projects: ProjectOption[] }) {
  const apiClient = useApiClient();
  const tokens = useTokenOptions(engagementId);
  const [rows, setRows] = useState<MoveRow[]>([EMPTY_MOVE]);
  const [effective, setEffective] = useState<"now" | "next_period">("next_period");
  const [note, setNote] = useState("");

  const parsed = rows.map((row) => {
    const magnitude = row.amount.trim();
    const result = magnitude.startsWith("-")
      ? { value: "", error: "Enter a positive amount and pick Add or Pull back." }
      : signedBaseAmount(
          row.direction === "out" && magnitude !== "" ? `-${magnitude}` : magnitude,
          tokenDecimals(row.tokenId),
        );
    return { ...row, ...result };
  });
  const missingProject = parsed.some((r) => !r.target);
  const badAmount = parsed.some((r) => r.error);
  const missingAmount = parsed.some((r) => r.value === "");
  const moves: ChangeOrderItem[] =
    missingProject || badAmount || missingAmount
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

  const reason = missingProject
    ? "Choose a Project for every line."
    : badAmount
      ? "Fix the amounts marked in red."
      : missingAmount
        ? "Enter an amount for every line."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move budget</CardTitle>
        <CardDescription>
          Move Prepaid balance into a Project, or pull unspent budget back, once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <ColumnHeaders
            className={MOVE_ROW_GRID}
            labels={["Project", "Direction", "Token", "Amount", ""]}
          />
          {parsed.map((row, index) => (
            <div
              key={`${index}-${row.target}`}
              className={`${MOVE_ROW_GRID} border-b pb-3 last:border-b-0 last:pb-0 sm:border-b-0 sm:pb-0`}
            >
              <Field>
                <FieldLabel htmlFor={`move-target-${index}`} className={COLUMN_LABEL}>
                  Project
                </FieldLabel>
                <ProjectSelect
                  id={`move-target-${index}`}
                  value={row.target}
                  projects={projects}
                  placeholder="Choose a Project"
                  onChange={(target) => update(index, { target })}
                />
              </Field>
              <Field>
                <FieldLabel id={`move-direction-${index}`} className={COLUMN_LABEL}>
                  Direction
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  aria-labelledby={`move-direction-${index}`}
                  value={row.direction}
                  onValueChange={(value) => {
                    if (value === "in" || value === "out") update(index, { direction: value });
                  }}
                >
                  <ToggleGroupItem value="in">Add</ToggleGroupItem>
                  <ToggleGroupItem value="out">Pull back</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor={`move-token-${index}`} className={COLUMN_LABEL}>
                  Token
                </FieldLabel>
                <TokenSelect
                  id={`move-token-${index}`}
                  value={row.tokenId}
                  options={tokens}
                  onChange={(tokenId) => update(index, { tokenId })}
                />
              </Field>
              <Field data-invalid={row.error ? true : undefined}>
                <FieldLabel htmlFor={`move-amount-${index}`} className={COLUMN_LABEL}>
                  Amount
                </FieldLabel>
                <AmountInput
                  id={`move-amount-${index}`}
                  value={row.amount}
                  tokenId={row.tokenId}
                  invalid={Boolean(row.error)}
                  onChange={(amount) => update(index, { amount })}
                />
                {row.error && <FieldError>{row.error}</FieldError>}
              </Field>
              <div className="flex justify-end">
                {rows.length > 1 && (
                  <RemoveRowButton
                    label={`Remove line ${index + 1}`}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  />
                )}
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" onClick={() => setRows([...rows, EMPTY_MOVE])}>
              <PlusIcon data-icon="inline-start" aria-hidden />
              Add a line
            </Button>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="xs" className="group/help">
                <CaretRightIcon
                  data-icon="inline-start"
                  aria-hidden
                  className="transition-transform group-data-[state=open]/help:rotate-90"
                />
                How pull-backs work
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="max-w-prose px-2 pt-1 text-xs text-muted-foreground">
                A pull-back returns unspent budget to the Prepaid balance. It cannot exceed what
                this Engagement put into the Project, or what is not yet Allocated, Committed or
                Paid there.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <FieldSet>
          <FieldLegend variant="label">Takes effect</FieldLegend>
          <RadioGroup
            value={effective}
            onValueChange={(value) => {
              if (value === "now" || value === "next_period") setEffective(value);
            }}
          >
            <Field orientation="horizontal">
              <RadioGroupItem value="next_period" id="move-effective-next" />
              <FieldContent>
                <FieldLabel htmlFor="move-effective-next">From next month</FieldLabel>
                <FieldDescription>Applies with next month's Prepayment.</FieldDescription>
              </FieldContent>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="now" id="move-effective-now" />
              <FieldContent>
                <FieldLabel htmlFor="move-effective-now">Now</FieldLabel>
                <FieldDescription>Applies as soon as the other side approves.</FieldDescription>
              </FieldContent>
            </Field>
          </RadioGroup>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="move-note">Note (optional)</FieldLabel>
          <Input id="move-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </CardContent>
      <EditorFooter reason={reason}>
        <Button
          disabled={moves.length === 0 || propose.isPending}
          onClick={() =>
            propose.mutate(undefined, {
              onSuccess: () => {
                setRows([EMPTY_MOVE]);
                setNote("");
              },
            })
          }
        >
          {propose.isPending ? "Proposing…" : "Propose change order"}
        </Button>
      </EditorFooter>
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
      return `Applies with the Prepayment for ${changeOrder.effectivePeriod}.`;
    case "applied":
      return changeOrder.items.some((i) => i.kind === "plan_change")
        ? `Plan changes count from ${changeOrder.effectivePeriod}.`
        : "Applied to the Project budgets.";
    case "failed":
      return failureMessage(changeOrder.failureReason ?? "");
    case "rejected":
      return "Rejected by the other side.";
    case "withdrawn":
      return "Withdrawn.";
  }
}

function ChangeOrderRow({
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
    <Item asChild variant="outline" size="sm">
      <li>
        <ItemHeader className="flex-wrap">
          <div className="flex flex-wrap items-center gap-2">
            <ChangeOrderStatusBadge status={changeOrder.status} />
            <span className="text-muted-foreground">
              Proposed by {names[changeOrder.proposedBy.side]} on{" "}
              {formatDate(changeOrder.createdAt)}
            </span>
          </div>
          {(changeOrder.canDecide || changeOrder.canWithdraw) && (
            <ItemActions>
              {changeOrder.canDecide && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => reject.mutate(undefined)}
                  >
                    Reject
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => approve.mutate(undefined)}>
                    Approve
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
                  Withdraw
                </Button>
              )}
            </ItemActions>
          )}
        </ItemHeader>
        <ItemContent className="min-w-0">
          <div className="flex flex-col gap-2">
            {changeOrder.note && <p className="text-sm text-foreground">{changeOrder.note}</p>}
            <ul className="flex flex-col divide-y">
              {changeOrder.items.map((item, index) => (
                <li
                  key={`${index}-${item.projectId}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {item.kind === "plan_change" ? "Monthly plan · " : "One-off move · "}
                    </span>
                    {titleOf(item.projectId)}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {BigInt(item.amount) > 0n ? "+" : ""}
                    {formatTokenAmount(item.amount, item.tokenId)}
                  </span>
                </li>
              ))}
            </ul>
            {changeOrder.status === "failed" ? (
              <p className="text-xs text-destructive">{statusLine(changeOrder)}</p>
            ) : (
              <ItemDescription>{statusLine(changeOrder)}</ItemDescription>
            )}
          </div>
        </ItemContent>
      </li>
    </Item>
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
  if (listQuery.isLoading) return <ListSkeleton />;
  const all = listQuery.data?.data ?? [];
  const shown = all.filter((c) => (c.status === "proposed" || c.status === "approved") === pending);
  if (shown.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyTitle>{pending ? "Nothing pending" : "No decided Change orders yet"}</EmptyTitle>
          <EmptyDescription>
            {pending
              ? "Proposed Change orders wait here for a decision."
              : "Approved, rejected and withdrawn Change orders are listed here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ItemGroup>
      {shown.map((changeOrder) => (
        <ChangeOrderRow
          key={changeOrder.id}
          changeOrder={changeOrder}
          names={names}
          projects={projects}
        />
      ))}
    </ItemGroup>
  );
}

function ChangeOrderEditors({
  engagementId,
  projects,
}: {
  engagementId: string;
  projects: ProjectOption[];
}) {
  return (
    <Tabs defaultValue="plan">
      <TabsList>
        <TabsTrigger value="plan">Edit the plan</TabsTrigger>
        <TabsTrigger value="move">One-off move</TabsTrigger>
      </TabsList>
      <TabsContent value="plan">
        <PlanEditor engagementId={engagementId} projects={projects} />
      </TabsContent>
      <TabsContent value="move">
        <MoveForm engagementId={engagementId} projects={projects} />
      </TabsContent>
    </Tabs>
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
    <div className="flex flex-col gap-6">
      <ShortfallWarnings engagementId={engagementId} projects={projects} />
      <AllocationPlanCard engagementId={engagementId} projects={projects} />
      <Card>
        <CardHeader>
          <CardTitle>Pending Change orders</CardTitle>
          <CardDescription>
            An owner or admin of {names[other]} decides the ones you propose, and you decide theirs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangeOrderHistory
            engagementId={engagementId}
            names={names}
            projects={projects}
            pending
          />
        </CardContent>
      </Card>
      {active && canManage && (
        <ChangeOrderEditors engagementId={engagementId} projects={projects} />
      )}
      {active && !canManage && (
        <Alert>
          <AlertDescription>
            Only owners and admins propose and decide Change orders. You can follow everything here.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Change orders that were applied, rejected or withdrawn.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangeOrderHistory
            engagementId={engagementId}
            names={names}
            projects={projects}
            pending={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
