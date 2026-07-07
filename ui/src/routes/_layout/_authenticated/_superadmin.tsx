import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/_superadmin")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
    if (session?.user?.role !== "admin") {
      throw redirect({ to: "/", hash: "unauthorized" });
    }
    return { roles: { orgRole: null } };
  },
  component: () => <Outlet />,
});
