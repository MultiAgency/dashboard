import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components";
import { ChangeOrdersPanel } from "@/components/change-orders-panel";
import { PrepaymentsPanel } from "@/components/prepayments-panel";
import { useMeRoles } from "@/hooks";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/plan")({
  head: () => ({ meta: [{ title: "Plan | Client portal" }] }),
  component: ClientPlanPage,
});

function ClientPlanPage() {
  const { engagement, engagementId } = Route.useRouteContext();
  const apiClient = useApiClient();
  const { canAccessAdmin } = useMeRoles();
  const projectsQuery = useQuery(clientPortalProjectsListQueryOptions(apiClient, engagementId));
  const projects = (projectsQuery.data?.data ?? []).map((p) => ({ id: p.id, title: p.title }));
  const canManage = canAccessAdmin && engagement.status === "active";

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <PrepaymentsPanel engagementId={engagementId} canManage={false} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Your prepaid money is split across projects by the allocation plan you agreed with your
            agency. Propose a change order to change the plan or move money; your agency approves it
            before it takes effect.
          </p>
          <ChangeOrdersPanel
            engagementId={engagementId}
            side="client"
            canManage={canManage}
            projects={projects}
          />
        </CardContent>
      </Card>
    </div>
  );
}
