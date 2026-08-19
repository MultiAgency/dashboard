import { createFileRoute, Link } from "@tanstack/react-router";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/billings/")({
  head: () => ({
    meta: [{ title: "Billings | Admin" }],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(adminProjectsListQueryOptions(context.apiClient));
  },
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminBillingsPage,
});

function AdminBillingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          money · billings
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Billings
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          All recorded payouts across projects. To record a new billing, open the{" "}
          <Link to="/admin/projects" className="underline underline-offset-2 hover:text-foreground">
            project
          </Link>{" "}
          where the work happened. Cross-project budget transfers live under{" "}
          <Link to="/admin/budgets" className="underline underline-offset-2 hover:text-foreground">
            advanced budgets
          </Link>
          .
        </p>
      </header>
      <BillingsAdminSection />
    </div>
  );
}
