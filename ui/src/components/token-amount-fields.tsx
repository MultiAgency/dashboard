import { Field, selectClass } from "@/components/admin-form";
import { Input } from "@/components/ui/input";
import { parseDecimalToBase } from "@/lib/format-amount";

export type KnownToken = {
  tokenId: string;
  network: string;
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
};

export const CUSTOM_TOKEN = "__custom__";

export function TokenAmountFields({
  idPrefix,
  tokens,
  tokenSelection,
  setTokenSelection,
  customTokenId,
  setCustomTokenId,
  amount,
  setAmount,
  amountError,
  disabled,
}: {
  idPrefix: string;
  tokens: KnownToken[];
  tokenSelection: string;
  setTokenSelection: (v: string) => void;
  customTokenId: string;
  setCustomTokenId: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  amountError?: string;
  disabled?: boolean;
}) {
  const isCustom = tokenSelection === CUSTOM_TOKEN;
  const effectiveTokenId = isCustom ? customTokenId.trim() : tokenSelection;
  const knownToken = tokens.find((t) => t.tokenId === effectiveTokenId);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="token" htmlFor={`${idPrefix}-token`}>
          <select
            id={`${idPrefix}-token`}
            value={tokenSelection}
            onChange={(e) => setTokenSelection(e.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            {tokens.map((t) => (
              <option key={t.tokenId} value={t.tokenId}>
                {t.symbol} — {t.name}
              </option>
            ))}
            <option value={CUSTOM_TOKEN}>Custom…</option>
          </select>
          {knownToken?.icon && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <img src={knownToken.icon} alt="" width={16} height={16} className="rounded-full" />
              <span className="font-mono">{knownToken.tokenId}</span>
            </div>
          )}
        </Field>
        <Field
          label={knownToken ? `amount (${knownToken.symbol})` : "amount (smallest unit)"}
          htmlFor={`${idPrefix}-amount`}
        >
          <Input
            id={`${idPrefix}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={knownToken ? "1.5" : "1000000000000000000000000"}
            disabled={disabled}
          />
        </Field>
      </div>
      {isCustom && (
        <Field label="custom token id" htmlFor={`${idPrefix}-custom-token`}>
          <Input
            id={`${idPrefix}-custom-token`}
            value={customTokenId}
            onChange={(e) => setCustomTokenId(e.target.value)}
            placeholder="e.g. usdc.token.near"
            disabled={disabled}
          />
        </Field>
      )}
      {isCustom && customTokenId.trim().length > 0 && !knownToken && (
        <p className="text-xs text-muted-foreground">
          ⚠ Decimals unknown for "{effectiveTokenId}". Enter the amount in the token's smallest
          integer unit.
        </p>
      )}
      {amountError && <p className="text-xs text-destructive">{amountError}</p>}
    </>
  );
}

export function deriveBaseAmount(
  amount: string,
  knownToken: KnownToken | undefined,
): { value: string; error: string } {
  const trimmed = amount.trim();
  if (trimmed === "") return { value: "", error: "" };
  if (knownToken) {
    try {
      return { value: parseDecimalToBase(trimmed, knownToken.decimals), error: "" };
    } catch (e) {
      return { value: "", error: (e as Error).message };
    }
  }
  return /^\d+$/.test(trimmed)
    ? { value: trimmed, error: "" }
    : { value: "", error: "Amount must be a positive integer (smallest unit)" };
}
