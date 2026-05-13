import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Empty as ShadcnEmpty, EmptyTitle as ShadcnEmptyTitle } from "@/components/ui/empty";
import {
  Field as ShadcnField,
  FieldDescription as ShadcnFieldDescription,
  FieldLabel as ShadcnFieldLabel,
} from "@/components/ui/field";

export function Loading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="h-3 w-1/4 bg-muted animate-pulse" />
        <div className="h-3 w-3/4 bg-muted animate-pulse" />
        <div className="h-3 w-1/2 bg-muted animate-pulse" />
        <span className="sr-only">{label}</span>
      </CardContent>
    </Card>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <ShadcnEmpty className="border-2 border-dashed border-border/40">
      <ShadcnEmptyTitle className="text-sm font-normal text-muted-foreground">
        {label}
      </ShadcnEmptyTitle>
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
      <ShadcnFieldLabel
        htmlFor={htmlFor}
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </ShadcnFieldLabel>
      {children}
      {helper && (
        <ShadcnFieldDescription className="text-xs leading-relaxed">
          {helper}
        </ShadcnFieldDescription>
      )}
    </ShadcnField>
  );
}

export const textareaClass =
  "flex w-full border-2 border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export const selectClass =
  "flex h-10 w-full border-2 border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50";
