import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryOptions, setActiveOrganizationKey } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, apiClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );

    if (!session?.user) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    setActiveOrganizationKey(session.session?.activeOrganizationId);

    void queryClient.prefetchQuery(meRolesQueryOptions(apiClient));

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
