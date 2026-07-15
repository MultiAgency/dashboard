import { createFileRoute } from "@tanstack/react-router";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminContributorsListQueryOptions, adminProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/billings/")({
  head: () => ({
    meta: [{ title: "Billings | Admin" }],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(adminProjectsListQueryOptions(context.apiClient)),
      context.queryClient.ensureQueryData(adminContributorsListQueryOptions(context.apiClient)),
    ]);
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
          admin · billings
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Billings
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Flat list of recorded billings. Filter by project or contributor.
        </p>
      </header>
      <BillingsAdminSection />
    </div>
  );
}
