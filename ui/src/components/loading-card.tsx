import { Skeleton } from "@/components/ui/skeleton";

export function LoadingCard({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border p-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
      <span className="sr-only">Loading {label}</span>
    </div>
  );
}
