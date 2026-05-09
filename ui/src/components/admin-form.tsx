import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function Loading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div className="h-3 w-1/4 bg-muted animate-pulse rounded" />
        <div className="h-3 w-3/4 bg-muted animate-pulse rounded" />
        <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
        <span className="sr-only">{label}</span>
      </CardContent>
    </Card>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card py-10 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export const textareaClass =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
