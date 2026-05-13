import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSessionFromData, type SessionData, sessionQueryOptions } from "@/lib/auth";

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

    // Prefetch role flags so operator sections render without a flash.
    await queryClient.ensureQueryData({
      queryKey: ["me", "roles"],
      queryFn: () => apiClient.me.roles(),
      staleTime: 60_000,
      retry: false,
    });

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
