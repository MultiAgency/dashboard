import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context }) => {
    const { queryClient, apiClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );

    if (!session?.user) {
      throw redirect({ to: "/" });
    }

    // Non-fatal prefetch — warms meRoles so operator sections don't flash on hydration.
    await queryClient.ensureQueryData(meRolesQueryOptions(apiClient)).catch(() => {});

    return {
      session,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="min-h-screen">
      <Outlet />
    </div>
  );
}
