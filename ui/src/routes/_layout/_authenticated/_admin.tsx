import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/_admin")({
  beforeLoad: async ({ context }) => {
    const { auth } = context;

    // Read from parent authenticated context instead of refetching
    if (!auth?.isAuthenticated) {
      throw redirect({ to: "/login" });
    }

    if (auth.isBanned) {
      throw redirect({ to: "/login", hash: "banned" });
    }

    if (!auth.isAdmin) {
      // Redirect to unauthorized page instead of silently bouncing to root
      throw redirect({ to: "/", hash: "unauthorized" });
    }

    return { auth };
  },
  component: () => <Outlet />,
});
