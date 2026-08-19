import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge, Card, CardContent } from "@/components";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { AdminError } from "@/components/admin-error";
import { TokenAmountCell } from "@/components/token-amounts";
import { useApiClient } from "@/lib/api";
import {
  clientPortalDashboardSummaryQueryOptions,
  clientPortalProjectsListQueryOptions,
} from "@/lib/queries";
import { tokenDisplayName } from "@/lib/report-amounts";

export const Route = createFileRoute("/_layout/_authenticated/client/")({
  component: ClientHome,
});

function ClientHome() {
  const { client, agencyDaoAccountId } = Route.useRouteContext();
  const apiClient = useApiClient();
  const projectsQuery = useQuery(
    clientPortalProjectsListQueryOptions(apiClient, agencyDaoAccountId),
  );
  const summaryQuery = useQuery(
    clientPortalDashboardSummaryQueryOptions(apiClient, agencyDaoAccountId),
  );
  const clientProjects = projectsQuery.data?.data ?? [];
  const remaining = summaryQuery.data?.remainingByToken ?? [];

  if (summaryQuery.isError) {
    return <AdminError error={summaryQuery.error} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Projects</div>
            <div className="font-display text-3xl font-black">
              {summaryQuery.data?.projectCount ?? clientProjects.length}
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
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Access</div>
            <Badge variant="outline" className="mt-1">
              read-only
            </Badge>
            <div className="text-sm font-medium mt-2">{client.name}</div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          recent billings
        </h2>
        <BillingsAdminSection
          readOnly
          clientPortal
          clientId={client.id}
          agencyDaoAccountId={agencyDaoAccountId}
        />
      </section>
    </div>
  );
}
