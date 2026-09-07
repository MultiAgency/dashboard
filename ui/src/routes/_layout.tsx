import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppNotFound, AppRouteError, Shell } from "@/components/shell";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout")({
  head: () => ({ meta: [{ name: "theme-color", content: "#ffff33" }] }),
  beforeLoad: ({ context }) => {
    if (context.session) {
      void context.queryClient.prefetchQuery(meRolesQueryOptions(context.apiClient));
    }
  },
  component: Layout,
  notFoundComponent: LayoutNotFound,
  errorComponent: LayoutError,
});

function Layout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

function LayoutNotFound() {
  return (
    <Shell>
      <AppNotFound />
    </Shell>
  );
}

function LayoutError() {
  return (
    <Shell>
      <AppRouteError />
    </Shell>
  );
}
