import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components";
import { Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import type { EngagementView } from "@/components/engagement-status";
import { PrepaidBalanceCard, PrepaymentTable, type PrepaymentView } from "@/components/prepayments";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { baseToDecimal, formatTokenAmount } from "@/lib/format-amount";
import { adminTokensQueryOptions, refreshAfter } from "@/lib/queries";
import {
  CUSTOM_TOKEN,
  deriveBaseAmount,
  type KnownToken,
  TokenAmountFields,
} from "./token-amount-fields";

type PrepaymentFields = {
  tokenId: string;
  amount: string;
  period: string;
  transferReference: string;
};

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function usePrepaymentMutation<TInput>(
  action: (input: TInput) => Promise<unknown>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "prepayments" });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function PrepaymentForm({
  idPrefix,
  tokens,
  initial,
  pending,
  submitLabel,
  onSubmit,
}: {
  idPrefix: string;
  tokens: KnownToken[];
  initial: { tokenId: string; amount: string; period: string; transferReference: string };
  pending: boolean;
  submitLabel: string;
  onSubmit: (fields: PrepaymentFields) => void;
}) {
  const known = tokens.some((t) => t.tokenId === initial.tokenId);
  const [tokenSelection, setTokenSelection] = useState(
    known || tokens.length === 0 ? initial.tokenId : CUSTOM_TOKEN,
  );
  const [customTokenId, setCustomTokenId] = useState(known ? "" : initial.tokenId);
  const [amount, setAmount] = useState(initial.amount);
  const [period, setPeriod] = useState(initial.period);
  const [transferReference, setTransferReference] = useState(initial.transferReference);

  const tokenId = tokenSelection === CUSTOM_TOKEN ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === tokenId);
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, knownToken);
  const positive = amountInBase !== "" && BigInt(amountInBase) > 0n;
  const canSubmit = tokenId !== "" && positive && !amountError && /^\d{4}-\d{2}$/.test(period);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) {
          onSubmit({
            tokenId,
            amount: amountInBase,
            period,
            transferReference: transferReference.trim(),
          });
        }
      }}
    >
      <TokenAmountFields
        idPrefix={idPrefix}
        tokens={tokens}
        tokenSelection={tokenSelection}
        setTokenSelection={setTokenSelection}
        customTokenId={customTokenId}
        setCustomTokenId={setCustomTokenId}
        amount={amount}
        setAmount={setAmount}
        amountError={amountError}
        disabled={pending}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="period (month)" htmlFor={`${idPrefix}-period`}>
          <Input
            id={`${idPrefix}-period`}
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="transfer link or hash (optional)" htmlFor={`${idPrefix}-transfer`}>
          <Input
            id={`${idPrefix}-transfer`}
            value={transferReference}
            onChange={(e) => setTransferReference(e.target.value)}
            placeholder="https://nearblocks.io/txns/…"
            disabled={pending}
          />
        </Field>
      </div>
      {knownToken && positive && (
        <p className="font-mono text-xs text-muted-foreground">
          {formatTokenAmount(amountInBase, tokenId)} = {amountInBase}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={!canSubmit || pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CorrectPrepaymentDialog({
  prepayment,
  tokens,
  onOpenChange,
}: {
  prepayment: PrepaymentView;
  tokens: KnownToken[];
  onOpenChange: (open: boolean) => void;
}) {
  const apiClient = useApiClient();
  const correct = usePrepaymentMutation(
    (fields: PrepaymentFields) =>
      apiClient.prepayments.correct({
        id: prepayment.id,
        ...fields,
        transferReference: fields.transferReference || null,
      }),
    "Prepayment corrected",
  );
  const decimals = tokens.find((t) => t.tokenId === prepayment.tokenId)?.decimals;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct Prepayment</DialogTitle>
          <DialogDescription>
            A correction is refused if the Prepaid balance would go below zero. Budget entries
            already made from it stay as they are.
          </DialogDescription>
        </DialogHeader>
        <PrepaymentForm
          idPrefix="correct-prepayment"
          tokens={tokens}
          initial={{
            tokenId: prepayment.tokenId,
            amount:
              decimals === undefined
                ? prepayment.amount
                : baseToDecimal(prepayment.amount, decimals),
            period: prepayment.period,
            transferReference: prepayment.transferReference ?? "",
          }}
          pending={correct.isPending}
          submitLabel="save correction"
          onSubmit={(fields) => correct.mutate(fields, { onSuccess: () => onOpenChange(false) })}
        />
      </DialogContent>
    </Dialog>
  );
}

export function PrepaymentsPanel({ engagement }: { engagement: EngagementView }) {
  const apiClient = useApiClient();
  const { canAccessAdmin, agencyDao } = useMeRoles();
  const tokens =
    useQuery({ ...adminTokensQueryOptions(apiClient), enabled: agencyDao !== null }).data?.tokens ??
    [];
  const [formKey, setFormKey] = useState(0);
  const [correcting, setCorrecting] = useState<PrepaymentView | null>(null);
  const [removing, setRemoving] = useState<PrepaymentView | null>(null);
  const active = engagement.status === "active";
  const writable = active && canAccessAdmin && agencyDao !== null;

  const record = usePrepaymentMutation(
    (fields: PrepaymentFields) =>
      apiClient.prepayments.record({
        engagementId: engagement.id,
        ...fields,
        transferReference: fields.transferReference || undefined,
      }),
    "Prepayment recorded",
  );
  const remove = usePrepaymentMutation(
    (id: string) => apiClient.prepayments.remove({ id }),
    "Prepayment removed",
  );

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Prepayments {engagement.client.name} made to reserve capacity, paid into your Agency DAO.
        The Prepaid balance is what they prepaid minus the Budget entries attributed to this
        Engagement, and it rolls over between months. {engagement.client.name}'s members see every
        Prepayment and the balance.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PrepaidBalanceCard engagementId={engagement.id} />
      </div>
      {active && canAccessAdmin && agencyDao === null && <ConnectTreasuryPrompt />}
      {writable && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-display text-lg uppercase font-extrabold">Record a Prepayment</h3>
            <PrepaymentForm
              key={formKey}
              idPrefix="record-prepayment"
              tokens={tokens}
              initial={{
                tokenId: "near",
                amount: "",
                period: currentPeriod(),
                transferReference: "",
              }}
              pending={record.isPending}
              submitLabel="record prepayment"
              onSubmit={(fields) =>
                record.mutate(fields, { onSuccess: () => setFormKey((k) => k + 1) })
              }
            />
          </CardContent>
        </Card>
      )}
      {!active && (
        <p className="text-sm text-muted-foreground">
          Prepayments of an Engagement that is not active are read-only.
        </p>
      )}
      <PrepaymentTable
        engagementId={engagement.id}
        actions={
          writable
            ? (prepayment) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setCorrecting(prepayment)}>
                    correct
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRemoving(prepayment)}>
                    remove
                  </Button>
                </div>
              )
            : undefined
        }
      />
      {correcting && (
        <CorrectPrepaymentDialog
          prepayment={correcting}
          tokens={tokens}
          onOpenChange={(open) => {
            if (!open) setCorrecting(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this Prepayment?"
        description={
          removing
            ? `${formatTokenAmount(removing.amount, removing.tokenId)} for ${removing.period}. Removing is refused if the Prepaid balance would go below zero. ${engagement.client.name} is notified.`
            : undefined
        }
        confirmLabel="remove"
        destructive
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
        }}
      />
    </section>
  );
}
