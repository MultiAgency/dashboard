import { createFileRoute } from "@tanstack/react-router";
import { ContributorsAdminSection } from "@/components/admin/contributors-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminContributorsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/contributors/")({
  head: () => ({
    meta: [{ title: "Contributors | Admin" }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminContributorsListQueryOptions(context.apiClient)),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminContributorsPage,
});

function AdminContributorsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · contributors
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Contributors
        </h1>
      </header>
      <ContributorsAdminSection />
    </div>
  );
}
