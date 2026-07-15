import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminSidebar } from "@/components/admin-sidebar";
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

function AdminLayout() {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8 animate-fade-in">
      <AdminSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
