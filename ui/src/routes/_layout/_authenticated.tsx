import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSessionFromData, type SessionData, sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryOptions } from "@/lib/queries";

export interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
}

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context }) => {
    const { queryClient, apiClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );

    const auth = getSessionFromData(session);

    if (!auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }

    // Non-fatal prefetch — warms meRoles so operator sections don't flash on hydration.
    await queryClient.ensureQueryData(meRolesQueryOptions(apiClient)).catch(() => {});

    return {
      auth,
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
