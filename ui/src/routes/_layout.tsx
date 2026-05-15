import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NotFound, Shell } from "@/components/shell";
import { meRolesQueryOptions, publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    // Non-fatal prefetches — settings warms the header brand; meRoles warms operator nav.
    await Promise.all([
      context.queryClient
        .ensureQueryData(publicSettingsQueryOptions(context.apiClient))
        .catch(() => {}),
      context.session
        ? context.queryClient
            .ensureQueryData(meRolesQueryOptions(context.apiClient))
            .catch(() => {})
        : Promise.resolve(),
    ]);
  },
  component: Layout,
  // In-subtree not-found (e.g. /work/junk); top-level misses hit __root's handler.
  notFoundComponent: () => <NotFound />,
});

function Layout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
