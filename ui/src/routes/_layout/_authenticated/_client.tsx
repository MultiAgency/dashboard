import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { meRolesQueryOptions } from "@/lib/queries";
import { sessionQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/_layout/_authenticated/_client")({
  beforeLoad: async ({ context }) => {
    const [session, roles] = await Promise.all([
      context.queryClient.ensureQueryData(
        sessionQueryOptions(context.authClient, context.session),
      ),
      context.queryClient.ensureQueryData(meRolesQueryOptions(context.apiClient)),
    ]);

    const isSuperAdmin = session?.user?.role === "admin";
    const isClient = roles.orgRole === "client";

    if (!isSuperAdmin && !isClient) {
      throw redirect({ to: "/", hash: "unauthorized" });
    }

    return { roles };
  },
  component: ClientLayout,
});

const TAB_BASE =
  "font-mono text-[11px] uppercase tracking-[0.18em] px-3 py-1.5 rounded-sm transition-colors";
const TAB_ACTIVE = "bg-foreground text-background";
const TAB_INACTIVE = "text-muted-foreground hover:text-foreground";

function ClientLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 border-b border-border pb-px">
        <Link
          to="/client"
          className={TAB_BASE}
          activeProps={{ className: `${TAB_BASE} ${TAB_ACTIVE}` }}
          inactiveProps={{ className: `${TAB_BASE} ${TAB_INACTIVE}` }}
        >
          home
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
