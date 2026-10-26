import { DotsThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  FieldGroup,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect, Empty, Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EngagementView } from "@/components/engagement-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ApiClient, useApiClient } from "@/lib/api";
import { formatPeriod, nextCycle, periodError } from "@/lib/budget-periods";
import { baseToDecimal, formatTokenAmount } from "@/lib/format-amount";
import { adminTokensQueryOptions, agreementsListQueryOptions, refreshAfter } from "@/lib/queries";
import { isoDate } from "@/lib/report-dates";
import { deriveBaseAmount, type KnownToken } from "./token-amount-fields";

export type Agreement = Awaited<ReturnType<ApiClient["agreements"]["list"]>>["data"][number];

type AgreementDraft = {
  mode: "new" | "edit" | "renew";
  id?: string;
  kind: "retainer" | "project";
  title: string;
  startDate: string;
  endDate: string;
  tokenId: string;
  amount: string;
  note: string;
};

const KIND_LABEL = { retainer: "Retainer", project: "Project agreement" } as const;

function toDisplay(amount: string, token: KnownToken | undefined): string {
  return token ? baseToDecimal(amount, token.decimals) : amount;
}

function draftOf(agreement: Agreement, tokens: KnownToken[]): AgreementDraft {
  const token = tokens.find((t) => t.tokenId === agreement.tokenId);
  return {
    mode: "edit",
    id: agreement.id,
    kind: agreement.kind,
    title: agreement.title,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    tokenId: agreement.tokenId,
    amount: toDisplay(agreement.agreedAmount, token),
    note: agreement.note ?? "",
  };
}

function renewalOf(agreement: Agreement, tokens: KnownToken[]): AgreementDraft {
  const next = nextCycle(agreement.startDate, agreement.endDate);
  return {
    ...draftOf(agreement, tokens),
    mode: "renew",
    id: undefined,
    startDate: next.start,
    endDate: next.end,
    note: "",
  };
}

function blankDraft(engagement: EngagementView): AgreementDraft {
  const today = new Date();
  const first = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  const last = isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  return {
    mode: "new",
    kind: "retainer",
    title: `${engagement.client.name} · `,
    startDate: first,
    endDate: last,
    tokenId: "near",
    amount: "",
    note: "",
  };
}

export function AgreementsPanel({
  engagement,
  canManage,
}: {
  engagement: EngagementView;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const agreementsQuery = useQuery(
    agreementsListQueryOptions(apiClient, { engagementId: engagement.id }),
  );
  const tokens =
    useQuery({ ...adminTokensQueryOptions(apiClient), enabled: canManage }).data?.tokens ?? [];
  const [draft, setDraft] = useState<AgreementDraft | null>(null);
  const [deleting, setDeleting] = useState<Agreement | null>(null);
  const writable = canManage && engagement.status === "active";

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.agreements.delete({ id }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "agreements" });
      toast.success("Agreement deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete the agreement"),
  });

  if (agreementsQuery.isError) return <AdminError error={agreementsQuery.error} />;
  const agreements = agreementsQuery.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Agreements</h2>
        </CardTitle>
        <CardDescription>
          Retainers and project agreements with {engagement.client.name}. Budgets on their projects
          are attached to one of these.
        </CardDescription>
        {writable && (
          <CardAction>
            <Button size="sm" onClick={() => setDraft(blankDraft(engagement))}>
              New agreement
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {agreements.length === 0 ? (
          <Empty label="No agreements yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Agreement</TableHead>
                <TableHead scope="col">Dates</TableHead>
                <TableHead scope="col">Allocated</TableHead>
                {writable && (
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreements.map((agreement) => (
                <TableRow key={agreement.id}>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {agreement.title}
                      <Badge variant="outline">{KIND_LABEL[agreement.kind]}</Badge>
                    </span>
                    {agreement.note && (
                      <span className="block text-sm text-muted-foreground">{agreement.note}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatPeriod(agreement.startDate, agreement.endDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatTokenAmount(agreement.allocated, agreement.tokenId)} of{" "}
                    {formatTokenAmount(agreement.agreedAmount, agreement.tokenId)}
                  </TableCell>
                  {writable && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {agreement.kind === "retainer" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDraft(renewalOf(agreement, tokens))}
                          >
                            Renew
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Agreement actions">
                              <DotsThreeIcon aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDraft(draftOf(agreement, tokens))}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleting(agreement)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {draft && (
            <AgreementForm
              key={draft.id ?? `new-${draft.startDate}`}
              engagementId={engagement.id}
              initial={draft}
              tokens={tokens}
              onDone={() => setDraft(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this agreement?"
        description={
          deleting
            ? deleting.budgetCount > 0
              ? `${deleting.title} has budget entries attached, so it can't be deleted until they are moved to another agreement or deleted.`
              : `${deleting.title}. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </Card>
  );
}

function AgreementForm({
  engagementId,
  initial,
  tokens,
  onDone,
}: {
  engagementId: string;
  initial: AgreementDraft;
  tokens: KnownToken[];
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof AgreementDraft>(key: K, value: AgreementDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const token = tokens.find((t) => t.tokenId === draft.tokenId);
  const { value: agreedAmount, error: amountError } = deriveBaseAmount(draft.amount, token);
  const datesError = periodError(draft.startDate, draft.endDate);
  const editing = draft.mode === "edit";
  const isRenewal = draft.mode === "renew";

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        kind: draft.kind,
        title: draft.title.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
        tokenId: draft.tokenId,
        agreedAmount,
        note: draft.note.trim() || null,
      };
      return editing && draft.id
        ? apiClient.agreements.update({ id: draft.id, ...fields })
        : apiClient.agreements.create({ engagementId, ...fields });
    },
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "agreements" });
      toast.success(editing ? "Agreement updated" : "Agreement added");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save the agreement"),
  });

  const canSave =
    draft.title.trim().length > 0 &&
    !datesError &&
    !!draft.endDate &&
    agreedAmount.length > 0 &&
    !amountError &&
    !save.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit agreement" : isRenewal ? "Renew retainer" : "New agreement"}
        </DialogTitle>
        <DialogDescription>
          {isRenewal
            ? "The next cycle, with the same amount. Change anything before saving."
            : "The dates and amount agreed with the client. Payments stay in Trezu."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field label="Kind" htmlFor="agreement-kind">
          <ChoiceSelect
            id="agreement-kind"
            value={draft.kind}
            onValueChange={(value) => set("kind", value as AgreementDraft["kind"])}
            options={[
              { value: "retainer", label: KIND_LABEL.retainer },
              { value: "project", label: KIND_LABEL.project },
            ]}
          />
        </Field>
        <Field label="Title" htmlFor="agreement-title">
          <Input
            id="agreement-title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            disabled={save.isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Start date" htmlFor="agreement-start">
            <Input
              id="agreement-start"
              type="date"
              value={draft.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              disabled={save.isPending}
            />
          </Field>
          <Field
            label={draft.kind === "retainer" ? "End date" : "Expected end"}
            htmlFor="agreement-end"
          >
            <Input
              id="agreement-end"
              type="date"
              value={draft.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              disabled={save.isPending}
            />
          </Field>
        </div>
        {datesError && <p className="text-sm text-destructive">{datesError}</p>}
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Token" htmlFor="agreement-token">
            <ChoiceSelect
              id="agreement-token"
              value={draft.tokenId}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, tokenId: value, amount: "" }))
              }
              options={(tokens.length > 0
                ? tokens
                : [{ tokenId: draft.tokenId, symbol: draft.tokenId }]
              ).map((t) => ({ value: t.tokenId, label: t.symbol }))}
            />
          </Field>
          <Field label="Agreed amount" htmlFor="agreement-amount">
            <Input
              id="agreement-amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set("amount", e.target.value)}
              disabled={save.isPending}
              aria-invalid={!!amountError}
            />
          </Field>
        </div>
        {amountError && <p className="text-sm text-destructive">{amountError}</p>}
        <Field label="Note" htmlFor="agreement-note">
          <Input
            id="agreement-note"
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Optional"
            disabled={save.isPending}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Add agreement"}
        </Button>
      </DialogFooter>
    </form>
  );
}
