import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import { TokenAmountCell } from "@/components/token-amounts";
import { useApiClient } from "@/lib/api";
import { parseDecimalToBase } from "@/lib/format-amount";
import {
  prepaymentsQueryKey,
  prepaymentsQueryOptions,
  tokensListQueryOptions,
} from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground";
const INPUT_LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground";

function monthBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function PrepaymentsPanel({
  engagementId,
  canManage,
}: {
  engagementId: string;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(prepaymentsQueryOptions(apiClient, engagementId));

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: prepaymentsQueryKey(engagementId) });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.prepayments.remove({ id }),
    onSuccess: async () => {
      toast.success("Prepayment removed");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isError) return <AdminError error={query.error} />;

  const prepayments = query.data?.data ?? [];
  const balance = query.data?.balance ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className={LABEL_CLS}>prepaid balance</div>
        {balance.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing prepaid yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {balance.map((row) => (
              <li key={row.tokenId} className="text-sm">
                <span className="text-muted-foreground mr-1">{tokenDisplayName(row.tokenId)}:</span>
                <TokenAmountCell amount={row.amount} tokenId={row.tokenId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {prepayments.length > 0 && (
        <div className="space-y-1">
          <div className={LABEL_CLS}>prepayments</div>
          <ul className="divide-y divide-border rounded-sm border border-border">
            {prepayments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="space-y-0.5">
                  <TokenAmountCell amount={p.amount} tokenId={p.tokenId} />
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {p.periodStart} → {p.periodEnd}
                    {p.transferReference && (
                      <>
                        {" · "}
                        <a
                          href={p.transferReference}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          transfer
                        </a>
                      </>
                    )}
                  </div>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(p.id)}
                    disabled={remove.isPending}
                  >
                    remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && <RecordPrepaymentForm engagementId={engagementId} onRecorded={refresh} />}
    </div>
  );
}

function RecordPrepaymentForm({
  engagementId,
  onRecorded,
}: {
  engagementId: string;
  onRecorded: () => Promise<void>;
}) {
  const apiClient = useApiClient();
  const tokensQuery = useQuery(tokensListQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];
  const month = monthBounds();
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("");
  const [periodStart, setPeriodStart] = useState(month.start);
  const [periodEnd, setPeriodEnd] = useState(month.end);
  const [transferReference, setTransferReference] = useState("");

  const selected = tokens.find((t) => t.tokenId === (tokenId || tokens[0]?.tokenId));

  const record = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a token");
      return apiClient.prepayments.record({
        engagementId,
        tokenId: selected.tokenId,
        amount: parseDecimalToBase(amount, selected.decimals),
        periodStart,
        periodEnd,
        transferReference: transferReference.trim() || undefined,
      });
    },
    onSuccess: async () => {
      toast.success("Prepayment recorded");
      setAmount("");
      setTransferReference("");
      await onRecorded();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    record.mutate();
  };

  return (
    <form className="grid gap-2 sm:grid-cols-6 items-end" onSubmit={submit}>
      <label className="grid gap-1 sm:col-span-1">
        <span className={INPUT_LABEL}>token</span>
        <select
          value={selected?.tokenId ?? ""}
          onChange={(e) => setTokenId(e.target.value)}
          className="rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs"
        >
          {tokens.map((t) => (
            <option key={t.tokenId} value={t.tokenId}>
              {t.symbol}
            </option>
          ))}
        </select>
      </label>
      <Field label="amount">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          required
        />
      </Field>
      <Field label="from">
        <Input
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          required
        />
      </Field>
      <Field label="to">
        <Input
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
          required
        />
      </Field>
      <Field label="transfer link">
        <Input value={transferReference} onChange={(e) => setTransferReference(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" disabled={record.isPending || !selected}>
        {record.isPending ? "recording..." : "record"}
      </Button>
    </form>
  );
}
