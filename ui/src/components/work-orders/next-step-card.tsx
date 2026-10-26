import { ArrowSquareOutIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components";
import { relativeTime } from "@/lib/format-date";
import type { WorkOrderProgress } from "./progress-stepper";

export type ProgressAction = NonNullable<WorkOrderProgress["next"]>;
export type InPageAction = Exclude<ProgressAction, { kind: "link" }>;

function waitingLine(progress: WorkOrderProgress, builderName: string): string | null {
  const since = progress.since ? ` · since ${relativeTime(progress.since)}` : "";
  switch (progress.waitingOn) {
    case "you":
      return `Waiting on you${since}`;
    case "builder":
      return `Waiting on ${builderName}${since}`;
    case "system":
      return `Automatic${since}`;
    case "dao":
      return `Waiting on the DAO${since}`;
    default:
      return progress.since ? `Since ${relativeTime(progress.since)}` : null;
  }
}

export function ActionButton({
  action,
  onAction,
  busy,
  variant = "default",
}: {
  action: ProgressAction;
  onAction: (action: InPageAction) => void;
  busy?: boolean;
  variant?: "default" | "outline";
}) {
  if (action.kind === "link") {
    if (action.external) {
      return (
        <Button size="sm" variant={variant} asChild>
          <a href={action.href} target="_blank" rel="noreferrer">
            {action.label}
            <ArrowSquareOutIcon data-icon="inline-end" aria-hidden />
          </a>
        </Button>
      );
    }
    const [path = "/", hash] = action.href.split("#");
    return (
      <Button size="sm" variant={variant} asChild>
        <Link to={path} hash={hash}>
          {action.label}
        </Link>
      </Button>
    );
  }
  return (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => onAction(action)}>
      {action.label}
    </Button>
  );
}

export function NextStepCard({
  progress,
  builderName,
  canManage,
  busy,
  onAction,
  children,
}: {
  progress: WorkOrderProgress;
  builderName: string;
  canManage: boolean;
  busy?: boolean;
  onAction: (action: InPageAction) => void;
  children?: ReactNode;
}) {
  const needsYou = progress.waitingOn === "you";
  const waiting = waitingLine(progress, builderName);
  return (
    <Card
      variant={needsYou ? "highlight" : "default"}
      className={cn(needsYou ? "ring-primary/40" : "bg-muted/30")}
      aria-label="Next step"
    >
      <CardHeader>
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Next step
        </span>
        <CardTitle>
          <h2 className="text-base">{progress.headline}</h2>
        </CardTitle>
        {waiting && (
          <CardDescription className={cn(needsYou && "font-medium text-primary")}>
            {waiting}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 empty:hidden">
        {canManage && progress.next && (
          <div className="flex flex-wrap gap-2">
            <ActionButton action={progress.next} onAction={onAction} busy={busy} />
          </div>
        )}
        {progress.attention.length > 0 && (
          <section aria-label="Needs attention" className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">Needs attention</h3>
            <ul className="flex flex-col gap-2">
              {progress.attention.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <WarningCircleIcon
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 break-words">{item.message}</span>
                  </span>
                  {canManage && item.action && (
                    <span className="shrink-0 pl-6 sm:pl-0">
                      <ActionButton
                        action={item.action}
                        onAction={onAction}
                        busy={busy}
                        variant="outline"
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
