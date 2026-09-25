import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminSidebar } from "@/components/admin-sidebar";
import { sessionQueryOptions } from "@/lib/auth";
import { isManager, isWorkspaceRole } from "@/lib/navigation";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin")({
  beforeLoad: async ({ context }) => {
    const [session, roles] = await Promise.all([
      context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient, context.session)),
      context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient)),
    ]);

    const isSuperAdmin = session?.user?.role === "admin";
    const orgRole = isWorkspaceRole(roles.orgRole) ? roles.orgRole : null;

    if (!isSuperAdmin && !orgRole) {
      throw redirect({ to: "/dashboard" });
    }

    return { session, isSuperAdmin, isOrgAdmin: isManager(orgRole) };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        organization dashboard
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
