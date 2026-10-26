import { CheckIcon, CircleIcon, WarningIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { shortDate } from "@/lib/format-date";
import type { WorkOrderDetail } from "./work-order-status";

export type WorkOrderProgress = WorkOrderDetail["progress"];
type Step = WorkOrderProgress["steps"][number];

const STATE_LABEL: Record<Step["state"], string> = {
  done: "done",
  current: "current step",
  blocked: "blocked",
  upcoming: "upcoming",
};

function StepIcon({ state }: { state: Step["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon weight="bold" className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background ring-4 ring-primary/15">
        <CircleIcon weight="fill" className="size-2.5 text-primary" aria-hidden />
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-destructive bg-background text-destructive">
        <WarningIcon weight="bold" className="size-3.5" aria-hidden />
      </span>
    );
  }
  return <span className="size-6 shrink-0 rounded-full border-2 border-border bg-background" />;
}

function caption(step: Step): string | null {
  if (step.at) return shortDate(step.at);
  if (step.state === "current" || step.state === "blocked") return step.detail;
  return null;
}

export function ProgressStepper({ progress }: { progress: WorkOrderProgress }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex flex-col md:flex-row">
        {progress.steps.map((step, index) => {
          const last = index === progress.steps.length - 1;
          const active = step.state === "current" || step.state === "blocked";
          const text = caption(step);
          return (
            <li
              key={step.key}
              aria-current={active ? "step" : undefined}
              className="relative flex min-w-0 flex-1 gap-3 pb-4 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
            >
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-7 bottom-0 left-3 w-px -translate-x-1/2 md:top-3 md:right-0 md:bottom-auto md:left-1/2 md:h-px md:w-full md:translate-x-3",
                    step.state === "done" ? "bg-primary" : "bg-border",
                  )}
                />
              )}
              <span className="relative z-10 md:flex md:justify-center">
                <StepIcon state={step.state} />
              </span>
              <span className="flex min-w-0 flex-col md:items-center md:px-1">
                <span
                  className={cn(
                    "text-sm leading-6 md:text-xs md:leading-4",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                    step.state === "blocked" && "text-destructive",
                  )}
                >
                  {step.label}
                  <span className="sr-only"> ({STATE_LABEL[step.state]})</span>
                </span>
                {text && (
                  <span className="truncate text-xs text-muted-foreground tabular-nums md:max-w-full">
                    {text}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
