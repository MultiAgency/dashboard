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
    <div className="flex animate-fade-in flex-col gap-6 lg:flex-row lg:gap-10">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
