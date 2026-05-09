import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminNav } from "@/components/admin-nav";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin" || location.pathname === "/admin/") {
      throw redirect({ to: "/admin/projects" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="space-y-6">
      <AdminNav />
      <Outlet />
    </div>
  );
}
