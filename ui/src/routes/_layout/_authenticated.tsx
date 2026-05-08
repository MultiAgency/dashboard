import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSessionFromData, type SessionData, sessionQueryOptions } from "@/lib/session";

export interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
}

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context }) => {
    const { queryClient } = context;

    const session = await queryClient.ensureQueryData(sessionQueryOptions(context.session));

    const auth = getSessionFromData(session);

    if (!auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }

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
