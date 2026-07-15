import { Button, Skeleton } from "@/components";

export function AdminSectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-slot="admin-section-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function AdminSectionError({
  error,
  onRetry,
}: {
  error: Error | null | undefined;
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-3 rounded-sm border border-destructive/60 px-4 py-3">
      <p className="text-sm text-destructive">{error?.message || "Failed to load this section"}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          retry
        </Button>
      )}
    </div>
  );
}
