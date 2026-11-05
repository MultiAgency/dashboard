import {
  CheckCircleIcon,
  CircleIcon,
  EnvelopeSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components";
import { Empty } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { dateTime } from "@/lib/format-date";
import { adminWorkOrderActivityQueryOptions } from "@/lib/queries";
import { activityTimeline, type TimelineTone } from "@/lib/work-order-activity";
import type { WorkOrderDetail } from "./work-order-status";

function ToneIcon({ tone }: { tone: TimelineTone }) {
  const className = "size-4";
  if (tone === "success")
    return <CheckCircleIcon weight="fill" className={className} aria-hidden />;
  if (tone === "destructive")
    return <WarningCircleIcon weight="fill" className={className} aria-hidden />;
  if (tone === "email") return <EnvelopeSimpleIcon className={className} aria-hidden />;
  return <CircleIcon weight="fill" className="size-2" aria-hidden />;
}

export function ActivityTimeline({ workOrder }: { workOrder: WorkOrderDetail }) {
  const apiClient = useApiClient();
  const activity = useQuery(adminWorkOrderActivityQueryOptions(apiClient, workOrder.id));
  const events = activityTimeline(workOrder, activity.data?.emails ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Activity</h2>
        </CardTitle>
        {activity.isError && <CardDescription>The emails couldn't be loaded.</CardDescription>}
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <Empty label="Nothing has happened yet." />
        ) : (
          <ol className="flex flex-col">
            {events.map((item, index) => (
              <li key={item.key} className="relative flex gap-3 pb-5 last:pb-0">
                {index < events.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border"
                  />
                )}
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border bg-background",
                    item.tone === "success" && "text-primary",
                    item.tone === "destructive" && "border-destructive/50 text-destructive",
                    (item.tone === "email" || item.tone === "default") && "text-muted-foreground",
                  )}
                >
                  <ToneIcon tone={item.tone} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5 pt-1 text-sm">
                  <span className="break-words font-medium">{item.title}</span>
                  {item.detail && (
                    <span
                      className={cn(
                        "break-words text-muted-foreground",
                        item.tone === "destructive" && "text-destructive",
                      )}
                    >
                      {item.detail}
                    </span>
                  )}
                  {item.href && (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit underline-offset-4 hover:underline"
                    >
                      {item.hrefLabel ?? "Open"}
                    </a>
                  )}
                  <time dateTime={item.at} className="text-xs text-muted-foreground tabular-nums">
                    {dateTime(item.at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
