export function allocationVerb(amount: string, relatedAllocationId: string | null): string {
  const negative = amount.startsWith("-");
  if (relatedAllocationId) return negative ? "transfer out" : "transfer in";
  return negative ? "deallocate" : "allocate";
}

export function VerbTag({ verb }: { verb: string }) {
  return (
    <span className="inline-block text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground border border-border bg-background px-1.5 py-0.5">
      {verb}
    </span>
  );
}
