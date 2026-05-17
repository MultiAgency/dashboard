import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { meRolesQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/_configured/_admin")({
  beforeLoad: async ({ context }) => {
    const roles = await context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient));

    if (!roles.isAdmin) {
      throw redirect({ to: "/", hash: "unauthorized" });
    }

    return { roles };
  },
  component: () => <Outlet />,
});
