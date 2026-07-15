import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsAdminSection } from "@/components/admin/applications-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";

export const Route = createFileRoute("/_layout/_authenticated/admin/applications/")({
  head: () => ({
    meta: [{ title: "Applications | Admin" }],
  }),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminApplicationsPage,
});

function AdminApplicationsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · applications
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Applications
        </h1>
      </header>
      <ApplicationsAdminSection />
    </div>
  );
}
