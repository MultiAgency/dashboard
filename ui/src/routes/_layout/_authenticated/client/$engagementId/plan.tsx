import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChangeOrdersPanel } from "@/components/change-orders";
import { PrepaidBalanceCard } from "@/components/prepayments";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";
import { clientPortalProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/plan")({
  component: EngagementPlan,
});

function EngagementPlan() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const { canAccessAdmin } = useMeRoles();
  const projects =
    useQuery(clientPortalProjectsListQueryOptions(apiClient, engagement.id)).data?.data ?? [];

  return (
    <section className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        The Allocation plan is how much of each month's Prepayment goes to each Project. Either side
        proposes a Change order to change the plan or move unspent budget; the other side approves
        it. Anything not in the plan stays in your Prepaid balance and rolls over.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PrepaidBalanceCard engagementId={engagement.id} />
      </div>
      <ChangeOrdersPanel
        engagementId={engagement.id}
        side="client"
        names={{ agency: engagement.agency.name, client: engagement.client.name }}
        projects={projects.map((p) => ({ id: p.id, title: p.title }))}
        active={engagement.status === "active"}
        canManage={canAccessAdmin}
      />
    </section>
  );
}
