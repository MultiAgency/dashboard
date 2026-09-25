import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { LoadError } from "@/components/load-error";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { needsTreasury } from "@/lib/treasury";

export function AdminSectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6" data-slot="admin-section-skeleton">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
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
  if (needsTreasury(error)) return <ConnectTreasuryPrompt />;
  return (
    <LoadError
      title="Could not load this section"
      description={error?.message || "Check your connection and try again."}
      onRetry={onRetry}
    />
  );
}
