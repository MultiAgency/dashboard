import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import type { ApiClient } from "@/lib/api";
import { clientLookupQueryOptions } from "@/lib/queries";

type ClientSearch = {
  agency?: string;
};

type ClientMembership = Awaited<
  ReturnType<ApiClient["clients"]["lookupByNearAccount"]>
>["memberships"][number];

function pickMembership(memberships: ClientMembership[], agency?: string) {
  const withAgency = memberships.filter((m) => m.client.agencyDaoAccountId);
  if (withAgency.length === 0) return null;

  if (agency) {
    const match = withAgency.find((m) => m.client.agencyDaoAccountId === agency);
    if (match) return match;
  }

  return withAgency[0] ?? null;
}

export const Route = createFileRoute("/_layout/_authenticated/client")({
  validateSearch: (search: Record<string, unknown>): ClientSearch => ({
    agency: typeof search.agency === "string" ? search.agency : undefined,
  }),
  beforeLoad: async ({ context, search, location }) => {
    const nearAccountId = context.authClient.near.getAccountId();
    if (!nearAccountId) {
      throw redirect({ to: "/client/forbidden" });
    }
    const lookup = await context.queryClient.ensureQueryData(
      clientLookupQueryOptions(context.apiClient, nearAccountId),
    );
    const active = pickMembership(lookup.memberships, search.agency);
    if (!active?.client.agencyDaoAccountId) {
      throw redirect({ to: "/client/forbidden" });
    }

    const agencyDaoAccountId = active.client.agencyDaoAccountId;

    if (search.agency !== agencyDaoAccountId) {
      throw redirect({
        to: location.pathname,
        search: { agency: agencyDaoAccountId },
        replace: true,
      });
    }

    return {
      client: active.client,
      projectIds: active.projectIds,
      nearAccountId,
      agencyDaoAccountId,
      memberships: lookup.memberships.filter((m) => m.client.agencyDaoAccountId),
    };
  },
  component: ClientLayout,
});

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

function shortAgency(id: string) {
  return id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-8)}` : id;
}

function ClientLayout() {
  const { client, agencyDaoAccountId, memberships } = Route.useRouteContext();
  const search = { agency: agencyDaoAccountId };
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
            {memberships.length === 1 && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {shortAgency(agencyDaoAccountId)}
              </p>
            )}
          </div>
          {memberships.length > 1 && (
            <AgencySwitcher memberships={memberships} agencyDaoAccountId={agencyDaoAccountId} />
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

function AgencySwitcher({
  memberships,
  agencyDaoAccountId,
}: {
  memberships: Array<{
    client: { id: string; name: string; agencyDaoAccountId: string | null };
    projectIds: string[];
  }>;
  agencyDaoAccountId: string;
}) {
  const navigate = Route.useNavigate();

  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        agency
      </span>
      <select
        value={agencyDaoAccountId}
        onChange={(e) => {
          void navigate({ to: "/client", search: { agency: e.target.value } });
        }}
        className="rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-xs max-w-[min(100vw-2rem,20rem)]"
      >
        {memberships.map((m) => {
          const id = m.client.agencyDaoAccountId!;
          return (
            <option key={m.client.id} value={id}>
              {m.client.name} · {shortAgency(id)}
            </option>
          );
        })}
      </select>
    </label>
  );
}
