import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import type { ApiClient } from "@/lib/api";
import { engagementsListQueryOptions } from "@/lib/queries";

type ClientSearch = {
  engagement?: string;
};

export type ClientEngagement = Awaited<
  ReturnType<ApiClient["engagements"]["list"]>
>["data"][number];

export function clientEngagements(engagements: ClientEngagement[]) {
  return engagements.filter(
    (e) => e.role === "client" && (e.status === "active" || e.status === "ended"),
  );
}

export const Route = createFileRoute("/_layout/_authenticated/client")({
  validateSearch: (search: Record<string, unknown>): ClientSearch => ({
    engagement: typeof search.engagement === "string" ? search.engagement : undefined,
  }),
  beforeLoad: async ({ context, search, location }) => {
    const listed = await context.queryClient
      .ensureQueryData(engagementsListQueryOptions(context.apiClient))
      .catch(() => ({ data: [] as ClientEngagement[] }));
    const engagements = clientEngagements(listed.data);
    const active =
      engagements.find((e) => e.id === search.engagement) ??
      engagements.find((e) => e.status === "active") ??
      engagements[0];
    if (!active) {
      throw redirect({ to: "/client-forbidden" });
    }

    if (search.engagement !== active.id) {
      throw redirect({
        to: location.pathname,
        search: { engagement: active.id },
        replace: true,
      });
    }

    return {
      client: { id: active.id, name: active.client.name },
      engagement: active,
      engagementId: active.id,
      engagements,
    };
  },
  component: ClientLayout,
});

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

function ClientLayout() {
  const { client, engagement, engagementId, engagements } = Route.useRouteContext();
  const search = { engagement: engagementId };
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const tabClass = (path: string) => {
    const active =
      path === "/client"
        ? pathname === "/client" || pathname === "/client/"
        : pathname === path || pathname.startsWith(`${path}/`);
    return `${TAB_BASE} ${active ? TAB_ACTIVE : TAB_INACTIVE}`;
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          client portal
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-black uppercase tracking-tight">
              {client.name}
            </h1>
            <p className="font-mono text-[10px] text-muted-foreground">
              with {engagement.agency.name || engagement.agency.organizationId}
              {engagement.status === "ended" && " · ended"}
            </p>
          </div>
          {engagements.length > 1 && (
            <EngagementSwitcher engagements={engagements} engagementId={engagementId} />
          )}
        </div>
      </header>
      <nav className="flex items-center gap-1 border-b border-border pb-px flex-wrap">
        <Link to="/client" search={search} className={tabClass("/client")}>
          dashboard
        </Link>
        <Link to="/client/projects" search={search} className={tabClass("/client/projects")}>
          projects
        </Link>
        <Link to="/client/reports" search={search} className={tabClass("/client/reports")}>
          reports
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

function EngagementSwitcher({
  engagements,
  engagementId,
}: {
  engagements: ClientEngagement[];
  engagementId: string;
}) {
  const navigate = Route.useNavigate();

  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        agency
      </span>
      <select
        value={engagementId}
        onChange={(e) => {
          void navigate({ to: "/client", search: { engagement: e.target.value } });
        }}
        className="rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs max-w-[min(100vw-2rem,20rem)]"
      >
        {engagements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.agency.name || e.agency.organizationId}
            {e.status === "ended" ? " (ended)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
