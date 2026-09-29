import { InfoIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
} from "@/components";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import type { EngagementView } from "@/components/engagement-status";
import { PrepaidBalanceCard, PrepaymentTable, type PrepaymentView } from "@/components/prepayments";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useRefreshingMutation } from "@/hooks/use-refreshing-mutation";
import { useApiClient } from "@/lib/api";
import { baseToDecimal, formatTokenAmount } from "@/lib/format-amount";
import { adminTokensQueryOptions } from "@/lib/queries";
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

function PrepaymentForm({
  engagementId,
  tokens,
  prepayment,
  onSaved,
}: {
  engagementId: string;
  tokens: KnownToken[];
  prepayment?: PrepaymentView;
  onSaved: () => void;
}) {
  const apiClient = useApiClient();
  const save = useRefreshingMutation(
    { type: "prepayments" },
    (fields: PrepaymentFields) =>
      prepayment
        ? apiClient.prepayments.correct({
            id: prepayment.id,
            ...fields,
            transferReference: fields.transferReference || null,
          })
        : apiClient.prepayments.record({
            engagementId,
            ...fields,
            transferReference: fields.transferReference || undefined,
          }),
    prepayment ? "Prepayment corrected" : "Prepayment recorded",
  );
  const idPrefix = prepayment ? "correct-prepayment" : "record-prepayment";
  const initialTokenId = prepayment?.tokenId ?? "near";
  const initialDecimals = tokens.find((t) => t.tokenId === initialTokenId)?.decimals;
  const known = initialDecimals !== undefined;
  const [tokenSelection, setTokenSelection] = useState(
    known || tokens.length === 0 ? initialTokenId : CUSTOM_TOKEN,
  );
  const [customTokenId, setCustomTokenId] = useState(known ? "" : initialTokenId);
  const [amount, setAmount] = useState(
    !prepayment
      ? ""
      : known
        ? baseToDecimal(prepayment.amount, initialDecimals)
        : prepayment.amount,
  );
  const [period, setPeriod] = useState(prepayment?.period ?? currentPeriod());
  const [transferReference, setTransferReference] = useState(prepayment?.transferReference ?? "");
  const pending = save.isPending;

  const tokenId = tokenSelection === CUSTOM_TOKEN ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === tokenId);
  const { value: amountInBase, error: amountError } = deriveBaseAmount(amount, knownToken);
  const positive = amountInBase !== "" && BigInt(amountInBase) > 0n;
  const canSubmit = tokenId !== "" && positive && !amountError && /^\d{4}-\d{2}$/.test(period);
  const reason =
    tokenId === ""
      ? "Enter a token ID."
      : amount.trim() === ""
        ? "Enter an amount."
        : !positive && !amountError
          ? "The amount must be above zero."
          : !/^\d{4}-\d{2}$/.test(period)
            ? "Choose a month."
            : null;

  const fields = (
    <div className="flex flex-col gap-4">
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
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-period`}>Month</FieldLabel>
          <Input
            id={`${idPrefix}-period`}
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-transfer`}>Transfer link or hash (optional)</FieldLabel>
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
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatTokenAmount(amountInBase, tokenId)} is {amountInBase} in base units.
        </p>
      )}
    </div>
  );

  const submit = (
    <Button type="submit" disabled={!canSubmit || pending}>
      {prepayment
        ? pending
          ? "Saving…"
          : "Save correction"
        : pending
          ? "Recording…"
          : "Record Prepayment"}
    </Button>
  );

  return (
    <form
      className={prepayment ? "flex flex-col gap-4" : "contents"}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) {
          save.mutate(
            { tokenId, amount: amountInBase, period, transferReference: transferReference.trim() },
            { onSuccess: onSaved },
          );
        }
      }}
    >
      {prepayment ? (
        <>
          {fields}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            {submit}
          </DialogFooter>
        </>
      ) : (
        <>
          <CardContent>{fields}</CardContent>
          <CardFooter className="flex-wrap justify-end gap-3">
            {reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
            {submit}
          </CardFooter>
        </>
      )}
    </form>
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

  const remove = useRefreshingMutation(
    { type: "prepayments" },
    (id: string) => apiClient.prepayments.remove({ id }),
    "Prepayment removed",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <PrepaidBalanceCard engagementId={engagement.id} />
      </div>
      {!active && (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertDescription>
            This Engagement is not active, so its Prepayments are read-only.
          </AlertDescription>
        </Alert>
      )}
      {active && canAccessAdmin && agencyDao === null && <ConnectTreasuryPrompt />}
      {writable && (
        <Card>
          <CardHeader>
            <CardTitle>Record a Prepayment</CardTitle>
            <CardDescription>
              What {engagement.client.name} paid into your Agency DAO to reserve capacity. Their
              members see it too.
            </CardDescription>
          </CardHeader>
          <PrepaymentForm
            key={formKey}
            engagementId={engagement.id}
            tokens={tokens}
            onSaved={() => setFormKey((k) => k + 1)}
          />
        </Card>
      )}
      <PrepaymentTable
        engagementId={engagement.id}
        description="The Prepaid balance is what was prepaid minus the budget taken from it. It rolls over between months."
        actions={
          writable
            ? (prepayment) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setCorrecting(prepayment)}>
                    <PencilSimpleIcon data-icon="inline-start" aria-hidden />
                    Correct
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove the Prepayment for ${prepayment.period}`}
                    onClick={() => setRemoving(prepayment)}
                  >
                    <TrashIcon aria-hidden />
                  </Button>
                </div>
              )
            : undefined
        }
      />
      <Dialog
        open={correcting !== null}
        onOpenChange={(open) => {
          if (!open) setCorrecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct Prepayment</DialogTitle>
            <DialogDescription>
              A correction is refused if the Prepaid balance would go below zero. Budget entries
              already made from it stay as they are.
            </DialogDescription>
          </DialogHeader>
          {correcting && (
            <PrepaymentForm
              key={correcting.id}
              engagementId={engagement.id}
              tokens={tokens}
              prepayment={correcting}
              onSaved={() => setCorrecting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
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
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
        }}
      />
    </div>
  );
}
