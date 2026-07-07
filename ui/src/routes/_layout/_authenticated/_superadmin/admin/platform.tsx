import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_superadmin/admin/platform")({
  component: PlatformLayout,
});

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

function PlatformLayout() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          super admin · platform
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Platform
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create and manage organizations, assign members, and view projects across all orgs.
          Project creation and org admin live on each org subdomain — org admins manage those
          surfaces.
        </p>
      </div>

      <nav className="flex items-center gap-1 border-b border-border pb-px">
        <Link
          to="/admin/platform"
          search={{ prefillSlug: undefined, prefillDaoAccountId: undefined }}
          className={TAB_BASE}
          activeOptions={{ exact: true }}
          activeProps={{ className: `${TAB_BASE} ${TAB_ACTIVE}` }}
          inactiveProps={{ className: `${TAB_BASE} ${TAB_INACTIVE}` }}
        >
          organizations
        </Link>
        <Link
          to="/admin/platform/projects"
          className={TAB_BASE}
          activeProps={{ className: `${TAB_BASE} ${TAB_ACTIVE}` }}
          inactiveProps={{ className: `${TAB_BASE} ${TAB_INACTIVE}` }}
        >
          projects
        </Link>
      </nav>

      <Outlet />
    </div>
  );
}
