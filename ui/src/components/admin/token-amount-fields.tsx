import { WarningIcon } from "@phosphor-icons/react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { parseDecimalToBase } from "@/lib/format-amount";
import { cn } from "@/lib/utils";

export type KnownToken = {
  tokenId: string;
  network: string;
  symbol: string;
  decimals: number;
  name: string;
  icon: string | null;
};

export const CUSTOM_TOKEN = "__custom__";

export function TokenSelect({
  id,
  value,
  onChange,
  options,
  custom,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (tokenId: string) => void;
  options: { tokenId: string; label: string }[];
  custom?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue placeholder="Choose a token" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.tokenId} value={option.tokenId}>
            {option.label}
          </SelectItem>
        ))}
        {custom && <SelectItem value={CUSTOM_TOKEN}>Custom token</SelectItem>}
      </SelectContent>
    </Select>
  );
}

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
  const unknownDecimals = isCustom && customTokenId.trim().length > 0 && !knownToken;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-token`}>Token</FieldLabel>
          <TokenSelect
            id={`${idPrefix}-token`}
            value={tokenSelection}
            onChange={setTokenSelection}
            options={tokens.map((t) => ({ tokenId: t.tokenId, label: `${t.symbol} · ${t.name}` }))}
            custom
            disabled={disabled}
          />
          {knownToken && (
            <FieldDescription>
              <span className="flex items-center gap-1.5 break-all">
                {knownToken.icon && (
                  <img
                    src={knownToken.icon}
                    alt=""
                    width={16}
                    height={16}
                    className="rounded-full"
                  />
                )}
                {knownToken.tokenId}
              </span>
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={amountError ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-amount`}>Amount</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={`${idPrefix}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={knownToken ? "1.5" : "1000000000000000000000000"}
              aria-invalid={amountError ? true : undefined}
              disabled={disabled}
            />
            <InputGroupAddon align="inline-end">
              {knownToken ? knownToken.symbol : "units"}
            </InputGroupAddon>
          </InputGroup>
          {amountError && <FieldError>{amountError}</FieldError>}
        </Field>
      </div>
      {isCustom && (
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-custom-token`}>Custom token ID</FieldLabel>
          <Input
            id={`${idPrefix}-custom-token`}
            value={customTokenId}
            onChange={(e) => setCustomTokenId(e.target.value)}
            placeholder="usdc.token.near"
            disabled={disabled}
          />
          {unknownDecimals && (
            <FieldDescription>
              <span className="flex items-start gap-1.5">
                <WarningIcon aria-hidden className="mt-0.5 shrink-0" />
                The decimals of {effectiveTokenId} are unknown, so enter the amount in its smallest
                whole unit.
              </span>
            </FieldDescription>
          )}
        </Field>
      )}
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
