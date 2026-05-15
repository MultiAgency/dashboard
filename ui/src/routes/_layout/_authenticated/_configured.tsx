import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { publicSettingsQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/_configured")({
  beforeLoad: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(
      publicSettingsQueryOptions(context.apiClient),
    );
    if (settings.isPlaceholder) {
      throw redirect({ to: "/settings" });
    }
  },
  component: ConfiguredLayout,
});

function ConfiguredLayout() {
  return <Outlet />;
}
