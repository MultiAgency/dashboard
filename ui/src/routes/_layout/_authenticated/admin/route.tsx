import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );

    const isSuperAdmin = session?.user?.role === "admin";

    let orgRole: string | null = null;
    if (session?.session?.activeOrganizationId) {
      const orgList = await context.authClient.organization.list();
      const activeOrg = (orgList.data ?? []).find(
        (o) => o.id === session.session!.activeOrganizationId,
      );
      orgRole = (activeOrg as { role?: string } | undefined)?.role ?? null;
    }
    const isOrgAdmin = orgRole === "admin" || orgRole === "owner";

    if (!isSuperAdmin && !isOrgAdmin) {
      throw redirect({ to: "/", hash: "unauthorized" });
    }

    return { session, isSuperAdmin, isOrgAdmin };
  },
  component: AdminLayout,
});

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

function AdminLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 border-b border-border pb-px">
        <Link
          to="/admin/settings"
          className={TAB_BASE}
          activeProps={{ className: `${TAB_BASE} ${TAB_ACTIVE}` }}
          inactiveProps={{ className: `${TAB_BASE} ${TAB_INACTIVE}` }}
        >
          settings
        </Link>
        <Link
          to="/admin/members"
          className={TAB_BASE}
          activeProps={{ className: `${TAB_BASE} ${TAB_ACTIVE}` }}
          inactiveProps={{ className: `${TAB_BASE} ${TAB_INACTIVE}` }}
        >
          members
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
