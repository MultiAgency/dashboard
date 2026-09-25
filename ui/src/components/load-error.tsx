import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function LoadError({
  title,
  description = "Check your connection and try again.",
  onRetry,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <WarningCircleIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
