import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppNotFound, AppRouteError } from "@/components/route-fallbacks";
import { Shell } from "@/components/shell";
import { meRolesQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(publicSettingsQueryOptions(context.apiClient)).catch(() => {}),
      context.session
        ? context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient)).catch(() => {})
        : Promise.resolve(),
    ]);
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
