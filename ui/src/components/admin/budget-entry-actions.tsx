import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
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
import { Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { type ApiClient, useApiClient } from "@/lib/api";
import { baseToDecimal, formatTokenAmount } from "@/lib/format-amount";
import { adminDeletedBudgetsQueryKey, refreshAfter } from "@/lib/queries";
import { deriveBaseAmount, type KnownToken } from "./token-amount-fields";

export type BudgetEntry = Awaited<ReturnType<ApiClient["budgets"]["list"]>>["data"][number];

function day(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function magnitude(amount: string): string {
  return amount.startsWith("-") ? amount.slice(1) : amount;
}

export function EditedLine({ entry }: { entry: BudgetEntry }) {
  if (!entry.lastEdit) return null;
  const { lastEdit } = entry;
  const changes = [
    lastEdit.previousAmount !== entry.amount
      ? `was ${formatTokenAmount(lastEdit.previousAmount, entry.tokenId)}`
      : null,
    lastEdit.previousEffectiveOn !== entry.effectiveOn && lastEdit.previousEffectiveOn
      ? `dated ${lastEdit.previousEffectiveOn}`
      : null,
  ].filter(Boolean);
  return (
    <span className="block">
      edited by {lastEdit.changedBy} on {day(lastEdit.changedAt)}
      {changes.length > 0 ? ` · ${changes.join(", ")}` : ""}
    </span>
  );
}

export function BudgetEntryActions({
  entry,
  tokens,
}: {
  entry: BudgetEntry;
  tokens: KnownToken[];
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isTransfer = entry.relatedBudgetId !== null;

  const remove = useMutation({
    mutationFn: () => apiClient.budgets.delete({ id: entry.id }),
    onSuccess: async (result) => {
      await refreshAfter(queryClient, { type: "budgetEntries", projectIds: [entry.projectId] });
      toast.success(result.deleted > 1 ? "Transfer deleted" : "Budget entry deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete the entry"),
  });

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {!isTransfer && (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
        Delete
      </Button>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <BudgetEditForm entry={entry} tokens={tokens} onDone={() => setEditing(false)} />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={isTransfer ? "Delete this transfer?" : "Delete this budget entry?"}
        description={`${formatTokenAmount(entry.amount, entry.tokenId)}${
          entry.note ? ` · ${entry.note}` : ""
        }. ${
          isTransfer ? "Both sides of the transfer are deleted. " : ""
        }It is removed from budgets and reports, and stays in the deleted entries list.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </div>
  );
}

function BudgetEditForm({
  entry,
  tokens,
  onDone,
}: {
  entry: BudgetEntry;
  tokens: KnownToken[];
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const token = tokens.find((t) => t.tokenId === entry.tokenId);
  const [amount, setAmount] = useState(() =>
    token ? baseToDecimal(magnitude(entry.amount), token.decimals) : magnitude(entry.amount),
  );
  const [effectiveOn, setEffectiveOn] = useState(entry.effectiveOn ?? day(entry.createdAt));
  const [note, setNote] = useState(entry.note ?? "");
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, token);
  const isDeallocation = entry.amount.startsWith("-");

  const save = useMutation({
    mutationFn: () =>
      apiClient.budgets.update({
        id: entry.id,
        amount: amountInBase,
        note: note.trim() || null,
        effectiveOn: effectiveOn || null,
      }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "budgetEntries", projectIds: [entry.projectId] });
      toast.success("Budget entry updated");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update the entry"),
  });

  const canSave = amountInBase.length > 0 && !amountError && !save.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{isDeallocation ? "Edit deallocation" : "Edit budget entry"}</DialogTitle>
        <DialogDescription>The previous version stays in the audit log.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field label={`Amount (${token?.symbol ?? entry.tokenId})`} htmlFor="edit-budget-amount">
          <Input
            id="edit-budget-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={save.isPending}
            aria-invalid={!!amountError}
          />
        </Field>
        {amountError && <p className="text-sm text-destructive">{amountError}</p>}
        <Field label="Budget date" htmlFor="edit-budget-date">
          <Input
            id="edit-budget-date"
            type="date"
            value={effectiveOn}
            onChange={(e) => setEffectiveOn(e.target.value)}
            disabled={save.isPending}
          />
        </Field>
        <Field label="Note" htmlFor="edit-budget-note">
          <Input
            id="edit-budget-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeletedBudgetEntries({
  projectId,
  projectTitleOf,
}: {
  projectId?: string;
  projectTitleOf?: (projectId: string) => string;
}) {
  const apiClient = useApiClient();
  const [open, setOpen] = useState(false);
  const deletedQuery = useQuery({
    queryKey: adminDeletedBudgetsQueryKey(projectId ?? null),
    queryFn: () => apiClient.budgets.deleted({ projectId, limit: 100 }),
  });
  const rows = deletedQuery.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide deleted entries" : `Show deleted entries (${rows.length})`}
        </Button>
      </div>
      {open && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Deleted</TableHead>
              <TableHead scope="col">Amount</TableHead>
              {projectTitleOf && <TableHead scope="col">Project</TableHead>}
              <TableHead scope="col">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {day(row.changedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums line-through">
                  {formatTokenAmount(row.amount, row.tokenId)}
                </TableCell>
                {projectTitleOf && <TableCell>{projectTitleOf(row.projectId)}</TableCell>}
                <TableCell className="whitespace-normal text-muted-foreground">
                  {row.note && <span className="block text-foreground">{row.note}</span>}
                  {row.effectiveOn && <span className="block">for {row.effectiveOn}</span>}
                  <span className="block">
                    recorded by {row.actorAccountId} on {day(row.budgetCreatedAt)}
                  </span>
                  <span className="block">deleted by {row.changedBy}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
