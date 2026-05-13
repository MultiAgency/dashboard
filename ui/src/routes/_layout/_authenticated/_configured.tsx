import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_configured")({
  beforeLoad: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData({
      queryKey: ["settings", "public"],
      queryFn: () => context.apiClient.settings.getPublic(),
      staleTime: 5 * 60_000,
    });
    if (settings.isPlaceholder) {
      throw redirect({ to: "/settings" });
    }
  },
  component: ConfiguredLayout,
});

function ConfiguredLayout() {
  return <Outlet />;
}
