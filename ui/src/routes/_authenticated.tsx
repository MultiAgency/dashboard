import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellError, ShellLayout, ShellNotFound, shellHead } from "@/components/shell-layout";
import { resolveSessionFromCache, sessionQueryOptions } from "@/lib/auth";
import { meRolesQueryOptions, setActiveOrganizationKey } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated")({
  head: shellHead,
  beforeLoad: async ({ context, location }) => {
    const { queryClient, apiClient } = context;

    resolveSessionFromCache(queryClient, context.session);
    const session = await queryClient.ensureQueryData(sessionQueryOptions(context.authClient));

    if (!session?.user) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
    setActiveOrganizationKey(session.session?.activeOrganizationId);

    void queryClient.prefetchQuery(meRolesQueryOptions(apiClient));

    return {
      session,
    };
  },
  component: ShellLayout,
  notFoundComponent: ShellNotFound,
  errorComponent: ShellError,
});
