import { ArrowRightIcon, BuildingsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  PageHeader,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  EngagementKindBadge,
  EngagementStatusBadge,
  type EngagementView,
} from "@/components/engagement-status";
import { useEngagementAction } from "@/hooks/use-engagement-action";
import { useApiClient } from "@/lib/api";
import { canReadEngagement, isManager } from "@/lib/navigation";
import { engagementsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/")({
  head: () => ({
    meta: [
      { title: "Agencies" },
      { name: "description", content: "The Agencies that work for your Organization." },
    ],
  }),
  component: AgenciesPage,
});

function AgenciesPage() {
  const apiClient = useApiClient();
  const { orgRole } = Route.useRouteContext();
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter((e) => e.side === "client");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agencies"
        description="Every Agency your Organization works with, through an Engagement. Open one to follow its shared Projects, billings and reports."
      />
      {engagementsQuery.isLoading ? (
        <AgenciesSkeleton />
      ) : engagementsQuery.isError ? (
        <AdminError error={engagementsQuery.error} />
      ) : engagements.length === 0 ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No Agencies yet</EmptyTitle>
            <EmptyDescription>
              When an Agency proposes to work for your Organization, it shows up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {engagements.map((engagement) => (
            <EngagementItem
              key={engagement.id}
              engagement={engagement}
              canDecide={isManager(orgRole)}
            />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

function AgenciesSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">Loading Agencies</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function engagementSummary(engagement: EngagementView): string {
  const count = engagement.projectIds.length;
  const projects = `${count} ${count === 1 ? "Project" : "Projects"}`;
  if (engagement.status === "proposed") {
    return `${engagement.agency.name} proposes to work for your Organization.`;
  }
  if (engagement.kind === "subcontract")
    return `${engagement.agency.name} hired you on ${projects}`;
  return `${count} shared ${count === 1 ? "Project" : "Projects"}`;
}

function EngagementItem({
  engagement,
  canDecide,
}: {
  engagement: EngagementView;
  canDecide: boolean;
}) {
  const apiClient = useApiClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const decide = useEngagementAction(
    (action: "accept" | "decline" | "end") => apiClient.engagements[action]({ id: engagement.id }),
    (_, action) =>
      action === "accept"
        ? `You now work with ${engagement.agency.name}`
        : action === "decline"
          ? "Proposal declined"
          : "Engagement ended",
  );

  return (
    <li>
      <Item variant="outline" size="sm">
        <ItemContent>
          <div className="flex flex-wrap items-center gap-2">
            <ItemTitle>{engagement.agency.name}</ItemTitle>
            <EngagementStatusBadge status={engagement.status} />
            <EngagementKindBadge kind={engagement.kind} />
          </div>
          <ItemDescription>{engagementSummary(engagement)}</ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap">
          {canDecide && engagement.status === "proposed" && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => decide.mutate("decline")}
              >
                Decline
              </Button>
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("accept")}>
                Accept
              </Button>
            </>
          )}
          {canDecide && engagement.status === "active" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>
              End
            </Button>
          )}
          {canReadEngagement(engagement.status) && (
            <Button asChild size="sm" variant="outline">
              <Link to="/client/$engagementId" params={{ engagementId: engagement.id }}>
                Open
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          )}
        </ItemActions>
      </Item>
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={`End the Engagement with ${engagement.agency.name}?`}
        description="The Agency can no longer share Projects with you through it. What was shared stays visible as read-only history."
        confirmLabel="End engagement"
        destructive
        onConfirm={async () => {
          await decide.mutateAsync("end");
        }}
      />
    </li>
  );
}
