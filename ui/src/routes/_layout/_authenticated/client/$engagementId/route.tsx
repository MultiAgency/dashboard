import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Badge } from "@/components";
import { EngagementKindBadge, EngagementStatusBadge } from "@/components/engagement-status";
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

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <EngagementStatusBadge status={engagement.status} />
            <EngagementKindBadge kind={engagement.kind} />
            {engagement.status === "ended" && <Badge variant="secondary">read-only</Badge>}
          </div>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight">
            {engagement.agency.name}
          </h1>
        </div>
        {others.length > 1 && (
          <label className="grid gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              agency
            </span>
            <select
              value={engagement.id}
              onChange={(e) => {
                void navigate({
                  to: "/client/$engagementId",
                  params: { engagementId: e.target.value },
                });
              }}
              className="rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs max-w-[min(100vw-2rem,20rem)]"
            >
              {others.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.agency.name}
                  {e.status === "ended" ? " (ended)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <nav className="flex items-center gap-1 border-b border-border pb-px flex-wrap">
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className={`${TAB_BASE} ${isActive(section.to) ? TAB_ACTIVE : TAB_INACTIVE}`}
          >
            {section.label}
            {section.to === planSection && awaiting > 0 && (
              <Badge variant="accent" className="ml-1 px-1.5 py-0 font-mono text-[10px]">
                {awaiting}
              </Badge>
            )}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
