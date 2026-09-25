import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import {
  Badge,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsTrigger,
} from "@/components";
import { EngagementKindBadge, EngagementStatusBadge } from "@/components/engagement-status";
import { ScrollableTabsList } from "@/components/scrollable-tabs-list";
import { useApiClient } from "@/lib/api";
import { awaitingCountFor } from "@/lib/change-orders";
import { canReadEngagement, clientEngagementSections } from "@/lib/navigation";
import {
  awaitingChangeOrdersQueryOptions,
  engagementDetailQueryOptions,
  engagementsListQueryOptions,
} from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId")({
  beforeLoad: async ({ context, params }) => {
    const engagement = await context.queryClient
      .ensureQueryData(engagementDetailQueryOptions(context.apiClient, params.engagementId))
      .catch(() => null);
    if (!engagement || engagement.side !== "client" || !canReadEngagement(engagement.status)) {
      throw redirect({ to: "/client" });
    }
    return { engagement };
  },
  component: EngagementLayout,
});

function EngagementLayout() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const navigate = Route.useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const others = (useQuery(engagementsListQueryOptions(apiClient)).data?.data ?? []).filter(
    (e) => e.side === "client" && canReadEngagement(e.status),
  );
  const sections = clientEngagementSections(engagement.id, engagement.kind);
  const awaiting = awaitingCountFor(
    useQuery(awaitingChangeOrdersQueryOptions(apiClient)).data?.data ?? [],
    engagement.id,
  );
  const planSection = `/client/${engagement.id}/plan`;

  const isActive = (to: string) =>
    to === sections[0]!.to
      ? pathname === to || pathname === `${to}/`
      : pathname === to || pathname.startsWith(`${to}/`);
  const current = sections.find((section) => isActive(section.to))?.to ?? sections[0]!.to;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={engagement.agency.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EngagementStatusBadge status={engagement.status} />
            <EngagementKindBadge kind={engagement.kind} />
            {engagement.status === "ended" && <Badge variant="secondary">read-only</Badge>}
          </span>
        }
        actions={
          others.length > 1 && (
            <Select
              value={engagement.id}
              onValueChange={(engagementId) => {
                void navigate({ to: "/client/$engagementId", params: { engagementId } });
              }}
            >
              <SelectTrigger aria-label="Switch Agency" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {others.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.agency.name}
                    {e.status === "ended" ? " (ended)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      <Tabs value={current} activationMode="manual">
        <ScrollableTabsList aria-label="Engagement sections">
          {sections.map((section) => (
            <TabsTrigger key={section.to} value={section.to} asChild>
              <Link to={section.to}>
                {section.label}
                {section.to === planSection && awaiting > 0 && (
                  <Badge size="counter" aria-label={`${awaiting} awaiting you`}>
                    {awaiting}
                  </Badge>
                )}
              </Link>
            </TabsTrigger>
          ))}
        </ScrollableTabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
