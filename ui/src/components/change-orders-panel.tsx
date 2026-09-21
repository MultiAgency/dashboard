import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { TokenAmountCell } from "@/components/token-amounts";
import type { ApiClient } from "@/lib/api";
import { useApiClient } from "@/lib/api";
import { parseDecimalToBase } from "@/lib/format-amount";
import {
  allocationPlanQueryOptions,
  changeOrdersQueryKey,
  changeOrdersQueryOptions,
  prepaymentsQueryKey,
  tokensListQueryOptions,
} from "@/lib/queries";

type ChangeOrder = Awaited<ReturnType<ApiClient["changeOrders"]["list"]>>["data"][number];
type Line = { projectId: string; tokenId: string; amount: string };
type Side = "agency" | "client";

const DECIDED = { approve: "approved", reject: "rejected", withdraw: "withdrawn" } as const;

const CHANGE_ORDER_PHASE: Record<
  ChangeOrder["status"],
  { variant: "default" | "outline"; open: boolean }
> = {
  proposed: { variant: "outline", open: true },
  approved: { variant: "default", open: false },
  rejected: { variant: "outline", open: false },
  withdrawn: { variant: "outline", open: false },
  failed: { variant: "outline", open: false },
};

function changeOrderLabel(order: ChangeOrder) {
  if (order.status === "approved" && !order.appliedAt) return "approved · waiting";
  return order.status;
}

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground";
const SELECT_CLS =
  "rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs min-w-0";

export function ChangeOrdersPanel({
  engagementId,
  side,
  canManage,
  projects,
}: {
  engagementId: string;
  side: Side;
  canManage: boolean;
  projects: Array<{ id: string; title: string }>;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const planQuery = useQuery(allocationPlanQueryOptions(apiClient, engagementId));
  const ordersQuery = useQuery(changeOrdersQueryOptions(apiClient, engagementId));
  const titleOf = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.title ?? projectId;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: changeOrdersQueryKey(engagementId) }),
      queryClient.invalidateQueries({ queryKey: prepaymentsQueryKey(engagementId) }),
    ]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "withdraw" }) =>
      apiClient.changeOrders[action]({ id }),
    onSuccess: async (_order, { action }) => {
      toast.success(`Change order ${DECIDED[action]}`);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (planQuery.isError) return <AdminError error={planQuery.error} />;
  if (ordersQuery.isError) return <AdminError error={ordersQuery.error} />;

  const plan = planQuery.data?.plan ?? null;
  const orders = ordersQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className={LABEL_CLS}>allocation plan</div>
        {plan ? (
          <>
            <p className="font-mono text-[10px] text-muted-foreground">
              per period, from {plan.effectiveFrom}
            </p>
            <LinesList lines={plan.lines} titleOf={titleOf} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No plan agreed yet.</p>
        )}
      </div>

      {orders.length > 0 && (
        <div className="space-y-1">
          <div className={LABEL_CLS}>change orders</div>
          <ul className="divide-y divide-border rounded-sm border border-border">
            {orders.map((order) => (
              <ChangeOrderRow
                key={order.id}
                order={order}
                side={side}
                canManage={canManage}
                titleOf={titleOf}
                pending={decide.isPending}
                onDecide={(action) => decide.mutate({ id: order.id, action })}
              />
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <ProposeChangeOrderForm
          engagementId={engagementId}
          projects={projects}
          onProposed={refresh}
        />
      )}
    </div>
  );
}

function LinesList({ lines, titleOf }: { lines: Line[]; titleOf: (id: string) => string }) {
  return (
    <ul className="space-y-0.5">
      {lines.map((line, index) => (
        <li key={`${line.projectId}-${line.tokenId}-${index}`} className="flex gap-2 text-sm">
          <span className="truncate">{titleOf(line.projectId)}</span>
          <TokenAmountCell amount={line.amount} tokenId={line.tokenId} />
        </li>
      ))}
    </ul>
  );
}

function ChangeOrderRow({
  order,
  side,
  canManage,
  titleOf,
  pending,
  onDecide,
}: {
  order: ChangeOrder;
  side: Side;
  canManage: boolean;
  titleOf: (id: string) => string;
  pending: boolean;
  onDecide: (action: "approve" | "reject" | "withdraw") => void;
}) {
  const phase = CHANGE_ORDER_PHASE[order.status];
  const mine = order.proposedBy === side;
  return (
    <li className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] text-muted-foreground">
          {order.proposedBy === side ? "you" : order.proposedBy} proposed ·{" "}
          {order.effective === "now" ? "right away" : "from next period"} ·{" "}
          {new Date(order.createdAt).toISOString().slice(0, 10)}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={phase.variant}>{changeOrderLabel(order)}</Badge>
          {phase.open && canManage && !mine && (
            <>
              <Button size="sm" onClick={() => onDecide("approve")} disabled={pending}>
                approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDecide("reject")}
                disabled={pending}
              >
                reject
              </Button>
            </>
          )}
          {phase.open && canManage && mine && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDecide("withdraw")}
              disabled={pending}
            >
              withdraw
            </Button>
          )}
        </div>
      </div>
      {order.moves.length > 0 && <LinesList lines={order.moves} titleOf={titleOf} />}
      {order.plan && (
        <div className="space-y-0.5">
          <div className="font-mono text-[10px] text-muted-foreground">new plan</div>
          <LinesList lines={order.plan} titleOf={titleOf} />
        </div>
      )}
      {order.note && <p className="text-sm text-muted-foreground">{order.note}</p>}
      {order.failureReason && <p className="text-sm text-destructive">{order.failureReason}</p>}
    </li>
  );
}

type DraftLine = { projectId: string; tokenId: string; amount: string; direction: "in" | "out" };

function ProposeChangeOrderForm({
  engagementId,
  projects,
  onProposed,
}: {
  engagementId: string;
  projects: Array<{ id: string; title: string }>;
  onProposed: () => Promise<unknown>;
}) {
  const apiClient = useApiClient();
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];
  const [kind, setKind] = useState<"moves" | "plan">("moves");
  const [effective, setEffective] = useState<"next_period" | "now">("next_period");
  const [note, setNote] = useState("");
  const emptyLine = (): DraftLine => ({
    projectId: projects[0]?.id ?? "",
    tokenId: tokens[0]?.tokenId ?? "",
    amount: "",
    direction: "in",
  });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const rows = lines.length > 0 ? lines : [emptyLine()];

  const update = (index: number, patch: Partial<DraftLine>) =>
    setLines(rows.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const propose = useMutation({
    mutationFn: async () => {
      const converted = rows.map((line) => {
        const token = tokens.find((t) => t.tokenId === (line.tokenId || tokens[0]?.tokenId));
        if (!token) throw new Error("Pick a token");
        const base = parseDecimalToBase(line.amount, token.decimals);
        const signed = kind === "moves" && line.direction === "out" ? `-${base}` : base;
        return {
          projectId: line.projectId || projects[0]?.id || "",
          tokenId: token.tokenId,
          amount: signed,
        };
      });
      return apiClient.changeOrders.propose({
        engagementId,
        effective,
        note: note.trim() || undefined,
        ...(kind === "moves" ? { moves: converted } : { plan: converted }),
      });
    },
    onSuccess: async () => {
      toast.success("Change order proposed");
      setLines([]);
      setNote("");
      await onProposed();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    propose.mutate();
  };

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">Share a project to propose changes.</p>;
  }

  return (
    <form className="space-y-3 rounded-sm border border-dashed border-border p-3" onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-3">
        <div className={LABEL_CLS}>propose a change</div>
        <select
          aria-label="change type"
          value={kind}
          onChange={(e) => setKind(e.target.value as "moves" | "plan")}
          className={SELECT_CLS}
        >
          <option value="moves">move money</option>
          <option value="plan">replace the plan</option>
        </select>
        <select
          aria-label="takes effect"
          value={effective}
          onChange={(e) => setEffective(e.target.value as "next_period" | "now")}
          className={SELECT_CLS}
        >
          <option value="next_period">from next period</option>
          <option value="now">right away (if both agree)</option>
        </select>
      </div>

      {rows.map((line, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          {kind === "moves" && (
            <select
              aria-label="direction"
              value={line.direction}
              onChange={(e) => update(index, { direction: e.target.value as "in" | "out" })}
              className={SELECT_CLS}
            >
              <option value="in">put into</option>
              <option value="out">pull back from</option>
            </select>
          )}
          <select
            aria-label="project"
            value={line.projectId || projects[0]?.id}
            onChange={(e) => update(index, { projectId: e.target.value })}
            className={SELECT_CLS}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <Input
            aria-label="amount"
            className="w-28"
            value={line.amount}
            onChange={(e) => update(index, { amount: e.target.value })}
            inputMode="decimal"
            placeholder="amount"
            required
          />
          <select
            aria-label="token"
            value={line.tokenId || tokens[0]?.tokenId}
            onChange={(e) => update(index, { tokenId: e.target.value })}
            className={SELECT_CLS}
          >
            {tokens.map((t) => (
              <option key={t.tokenId} value={t.tokenId}>
                {t.symbol}
              </option>
            ))}
          </select>
          {rows.length > 1 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLines(rows.filter((_, i) => i !== index))}
            >
              remove
            </Button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines([...rows, emptyLine()])}
        >
          add line
        </Button>
        <Input
          aria-label="note"
          className="flex-1 min-w-40"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
        />
        <Button type="submit" size="sm" disabled={propose.isPending}>
          {propose.isPending ? "proposing..." : "propose"}
        </Button>
      </div>
    </form>
  );
}
