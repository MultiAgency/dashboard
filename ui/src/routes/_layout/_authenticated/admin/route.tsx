import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminSidebar } from "@/components/admin-sidebar";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin")({
  beforeLoad: async ({ context, location }) => {
    const roles = await context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient));
    const isOrgAdmin = roles.orgRole === "admin" || roles.orgRole === "owner";
    const isProjectRoute =
      location.pathname === "/admin/projects" || location.pathname.startsWith("/admin/projects/");
    const isProjectMember = roles.orgRole === "member" && isProjectRoute;
    if (!isOrgAdmin && !isProjectMember) {
      throw redirect({
        to: "/",
        hash: roles.orgRole ? "unauthorized" : "organization-required",
      });
    }

    return { roles };
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        agency dashboard
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
