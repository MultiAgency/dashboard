import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { AgentLinksCard } from "@/components/agent-links";
import { PrepaidBalanceCard } from "@/components/prepayments";
import { TokenAmountCell } from "@/components/token-amounts";
import { useApiClient } from "@/lib/api";
import { clientPortalDashboardSummaryQueryOptions } from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/")({
  component: EngagementOverview,
});

function EngagementOverview() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const summaryQuery = useQuery(clientPortalDashboardSummaryQueryOptions(apiClient, engagement.id));
  const remaining = summaryQuery.data?.remainingByToken ?? [];

  if (summaryQuery.isError) return <AdminError error={summaryQuery.error} />;

  return (
    <div className="space-y-6">
      {engagement.status === "ended" && (
        <p className="text-sm text-muted-foreground">
          This Engagement ended on{" "}
          {engagement.endedAt ? new Date(engagement.endedAt).toISOString().slice(0, 10) : "—"}. Its
          Projects, budget and billings stay here as read-only history.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Shared projects</div>
            <div className="font-display text-3xl font-black">
              {summaryQuery.data?.projectCount ?? engagement.projectIds.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Budget remaining</div>
            {remaining.length === 0 ? (
              <div className="font-display text-2xl font-black mt-1">—</div>
            ) : (
              <ul className="mt-2 space-y-1">
                {remaining.map((row) => (
                  <li key={row.tokenId} className="text-sm">
                    <span className="text-muted-foreground mr-1">
                      {tokenDisplayName(row.tokenId)}:
                    </span>
                    <TokenAmountCell amount={row.amount} tokenId={row.tokenId} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <PrepaidBalanceCard engagementId={engagement.id} />
        <AgentLinksCard engagementId={engagement.id} />
      </div>
    </div>
  );
}
