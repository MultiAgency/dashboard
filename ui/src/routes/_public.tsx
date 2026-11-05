import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellError, ShellLayout, ShellNotFound, shellHead } from "@/components/shell-layout";
import { meRolesQueryOptions, setActiveOrganizationKey } from "@/lib/queries";

export const Route = createFileRoute("/_public")({
  head: shellHead,
  beforeLoad: ({ context, location }) => {
    if (location.pathname === "/login") {
      const target = (location.search as { redirect?: unknown }).redirect;
      throw redirect({
        to: "/sign-in",
        search: { redirect: typeof target === "string" ? target : undefined },
      });
    }
    setActiveOrganizationKey(context.session?.session?.activeOrganizationId);
    if (context.session) {
      void context.queryClient.prefetchQuery(meRolesQueryOptions(context.apiClient));
    }
  },
  component: ShellLayout,
  notFoundComponent: ShellNotFound,
  errorComponent: ShellError,
});
