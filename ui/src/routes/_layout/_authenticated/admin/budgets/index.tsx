import { createFileRoute, Link } from "@tanstack/react-router";
import { BudgetsManager } from "@/components/admin/budgets-manager";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/budgets/")({
  head: () => ({
    meta: [{ title: "Advanced budgets | Admin" }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminProjectsListQueryOptions(context.apiClient)),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminBudgetsPage,
});

function AdminBudgetsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          money · advanced budgets
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Advanced budgets
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Cross-project budget transfers and treasury-style views. Day-to-day allocate and
          deallocate on each{" "}
          <Link to="/admin/projects" className="underline underline-offset-2 hover:text-foreground">
            project page
          </Link>
          .
        </p>
      </header>
      <BudgetsManager />
    </div>
  );
}
