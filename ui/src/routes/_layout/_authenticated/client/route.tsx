import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminSidebar } from "@/components/admin-sidebar";
import { isWorkspaceRole } from "@/lib/navigation";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client")({
  beforeLoad: async ({ context }) => {
    const roles = await context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient));
    if (!isWorkspaceRole(roles.orgRole)) {
      throw redirect({ to: "/dashboard" });
    }
    return { orgRole: roles.orgRole };
  },
  component: ClientLayout,
});

function ClientLayout() {
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
