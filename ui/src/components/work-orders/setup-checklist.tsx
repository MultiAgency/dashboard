import {
  CaretRightIcon,
  CheckCircleIcon,
  CircleIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useApiClient } from "@/lib/api";
import { activeOrganizationKey, workOrderSetupQueryOptions } from "@/lib/queries";
import {
  fixTarget,
  type SetupCheck,
  type SetupState,
  setupDismissKey,
  setupSummary,
  splitOptional,
} from "@/lib/setup-status";
import { cn } from "@/lib/utils";

const ICONS: Record<
  SetupState,
  { icon: typeof CheckCircleIcon; className: string; label: string }
> = {
  ok: { icon: CheckCircleIcon, className: "text-primary", label: "Done" },
  missing: { icon: XCircleIcon, className: "text-destructive", label: "Missing" },
  warning: { icon: WarningIcon, className: "text-foreground", label: "Needs attention" },
  optional: { icon: CircleIcon, className: "text-muted-foreground", label: "Optional" },
};

function useSetupStatus() {
  const apiClient = useApiClient();
  const query = useQuery(workOrderSetupQueryOptions(apiClient));
  const mutating = useIsMutating();
  const wasMutating = useRef(false);
  const { refetch } = query;
  useEffect(() => {
    if (wasMutating.current && mutating === 0) void refetch();
    wasMutating.current = mutating > 0;
  }, [mutating, refetch]);
  return query;
}

function readDismissed(organizationId: string | null) {
  try {
    return localStorage.getItem(setupDismissKey(organizationId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(organizationId: string | null) {
  try {
    localStorage.setItem(setupDismissKey(organizationId), "1");
  } catch {}
}

function FixLink({
  href,
  className,
  newTab = false,
}: {
  href: string;
  className?: string;
  newTab?: boolean;
}) {
  const { path, hash } = fixTarget(href);
  if (newTab) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        Fix
      </a>
    );
  }
  if (path === "/admin/settings") {
    return (
      <Link to="/admin/settings" hash={hash ?? undefined} className={className}>
        Fix
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      Fix
    </a>
  );
}

function CheckRow({ check, tagged = true }: { check: SetupCheck; tagged?: boolean }) {
  const { icon: Icon, className, label } = ICONS[check.state];
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon aria-label={label} weight="fill" className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {check.label}
          {tagged && !check.required && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>
          )}
        </span>
        {check.detail && (
          <span className="text-xs break-words text-muted-foreground">{check.detail}</span>
        )}
      </div>
      {check.fixHref && (
        <FixLink
          href={check.fixHref}
          className="shrink-0 text-xs font-medium underline underline-offset-4"
        />
      )}
    </li>
  );
}

export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const query = useSetupStatus();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const organizationId = activeOrganizationKey();
  const dismissible = !compact;

  useEffect(() => {
    setDismissed(dismissible && readDismissed(organizationId));
  }, [dismissible, organizationId]);

  if (!query.data) return null;
  const summary = setupSummary(query.data);
  if (summary.ready && dismissed) return null;
  const open = expanded ?? (!compact && !summary.ready);
  const groups = splitOptional(query.data);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 border bg-card px-4 py-2 text-sm">
        {summary.ready ? (
          <CheckCircleIcon aria-hidden weight="fill" className="size-4 shrink-0 text-primary" />
        ) : (
          <XCircleIcon aria-hidden weight="fill" className="size-4 shrink-0 text-destructive" />
        )}
        <span className="flex-1">
          {summary.ready
            ? "All set to send work orders"
            : `Setup: ${summary.done} of ${summary.total} done`}
          {summary.attention.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              {summary.attention.length === 1
                ? "1 needs attention"
                : `${summary.attention.length} need attention`}
            </span>
          )}
        </span>
        <Button size="xs" variant="ghost" onClick={() => setExpanded(true)}>
          Show
        </Button>
        {dismissible && summary.ready && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => {
              writeDismissed(organizationId);
              setDismissed(true);
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Ready to send work orders</h2>
        </CardTitle>
        <CardDescription>
          {summary.done} of {summary.total} done
        </CardDescription>
        {(summary.ready || compact) && (
          <CardAction>
            <Button size="xs" variant="ghost" onClick={() => setExpanded(false)}>
              Hide
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {groups.main.map((check) => (
            <CheckRow key={check.key} check={check} />
          ))}
        </ul>
        {groups.optional.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="xs" className="group/optional mt-2">
                <CaretRightIcon
                  data-icon="inline-start"
                  aria-hidden
                  className="transition-transform group-data-[state=open]/optional:rotate-90"
                />
                Optional
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="flex flex-col divide-y">
                {groups.optional.map((check) => (
                  <CheckRow key={check.key} check={check} tagged={false} />
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

export function SetupPreflight() {
  const query = useSetupStatus();
  if (!query.data) return null;
  const { attention, blocking } = setupSummary(query.data);
  if (attention.length === 0) return null;
  return (
    <Alert variant={blocking.length > 0 ? "destructive" : "default"}>
      <AlertTitle>
        {blocking.length > 0 ? "Finish setup before sending" : "Check before sending"}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {attention.map((check) => (
            <li key={check.key}>
              <span className="font-medium">{check.label}</span>
              {check.detail && `: ${check.detail}`}
              {check.fixHref && (
                <>
                  {" "}
                  <FixLink
                    href={check.fixHref}
                    newTab
                    className="font-medium underline underline-offset-4"
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        <span>Fix links open in a new tab. You can still save this draft.</span>
      </AlertDescription>
    </Alert>
  );
}
