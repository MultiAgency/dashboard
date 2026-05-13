import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_configured/admin")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin" || location.pathname === "/admin/") {
      throw redirect({ to: "/work" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return <Outlet />;
}
