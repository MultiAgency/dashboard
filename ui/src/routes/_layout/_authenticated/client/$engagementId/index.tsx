import { ArrowRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { AgentLinksCard } from "@/components/agent-links";
import { PrepaidBalanceCard } from "@/components/prepayments";
import { TokenAmountCell } from "@/components/token-amounts";
import { useApiClient } from "@/lib/api";
import { clientPortalDashboardSummaryQueryOptions } from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/")({
  component: EngagementOverview,
});

const STAT_VALUE = "font-heading text-2xl font-semibold tabular-nums";

function EngagementOverview() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const summaryQuery = useQuery(clientPortalDashboardSummaryQueryOptions(apiClient, engagement.id));
  const remaining = summaryQuery.data?.remainingByToken ?? [];

  if (summaryQuery.isError) return <AdminError error={summaryQuery.error} />;

  return (
    <div className="flex flex-col gap-4">
      {engagement.status === "ended" && (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertTitle>
            This Engagement ended
            {engagement.endedAt
              ? ` on ${new Date(engagement.endedAt).toISOString().slice(0, 10)}`
              : ""}
          </AlertTitle>
          <AlertDescription>
            Its Projects, budget and billings stay here as read-only history.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Shared Projects</CardDescription>
            {summaryQuery.isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className={STAT_VALUE}>
                {summaryQuery.data?.projectCount ?? engagement.projectIds.length}
              </div>
            )}
            <CardAction>
              <Button asChild size="sm" variant="ghost">
                <Link to="/client/$engagementId/projects" params={{ engagementId: engagement.id }}>
                  View
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Budget remaining</CardDescription>
            {summaryQuery.isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : remaining.length === 0 ? (
              <div className={cn(STAT_VALUE, "text-muted-foreground")}>—</div>
            ) : null}
          </CardHeader>
          {remaining.length > 0 && (
            <CardContent>
              <ul className="flex flex-col gap-1">
                {remaining.map((row) => (
                  <li key={row.tokenId} className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">{tokenDisplayName(row.tokenId)}</span>
                    <TokenAmountCell amount={row.amount} tokenId={row.tokenId} />
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
        <PrepaidBalanceCard engagementId={engagement.id} />
        <AgentLinksCard engagementId={engagement.id} />
      </div>
    </div>
  );
}
