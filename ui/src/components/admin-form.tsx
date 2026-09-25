import { TrayIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  Empty as ShadcnEmpty,
  EmptyTitle as ShadcnEmptyTitle,
} from "@/components/ui/empty";
import {
  Field as ShadcnField,
  FieldDescription as ShadcnFieldDescription,
  FieldLabel as ShadcnFieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function Loading({ label }: { label: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
        <span className="sr-only">{label}</span>
      </CardContent>
    </Card>
  );
}

export function Empty({
  label,
  description,
  icon,
  children,
}: {
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <ShadcnEmpty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <TrayIcon aria-hidden />}</EmptyMedia>
        <ShadcnEmptyTitle>{label}</ShadcnEmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </ShadcnEmpty>
  );
}

export function Field({
  label,
  htmlFor,
  helper,
  children,
}: {
  label: string;
  htmlFor?: string;
  helper?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ShadcnField>
      <ShadcnFieldLabel htmlFor={htmlFor}>{label}</ShadcnFieldLabel>
      {children}
      {helper && <ShadcnFieldDescription>{helper}</ShadcnFieldDescription>}
    </ShadcnField>
  );
}

export type ChoiceOption = { value: string; label: ReactNode; disabled?: boolean };

const EMPTY_VALUE = "__none__";

export function ChoiceSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  emptyLabel,
  disabled,
  ariaLabel,
  size,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
  placeholder?: string;
  emptyLabel?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  size?: "sm" | "default";
}) {
  const hasEmpty = emptyLabel !== undefined;
  const current = value === "" ? (hasEmpty ? EMPTY_VALUE : "") : value;
  return (
    <Select
      value={current}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} size={size} className="w-full min-w-0">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {hasEmpty && <SelectItem value={EMPTY_VALUE}>{emptyLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const textareaClass =
  "flex w-full border-2 border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/45 placeholder:italic focus-visible:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";

export const selectClass =
  "flex h-10 w-full border-2 border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";
