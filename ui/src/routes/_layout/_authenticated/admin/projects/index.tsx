import { createFileRoute } from "@tanstack/react-router";
import { ProjectsAdminSection } from "@/components/admin/projects-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminAssignmentsListQueryOptions, adminProjectsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/projects/")({
  head: () => ({
    meta: [{ title: "Projects | Admin" }],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(adminProjectsListQueryOptions(context.apiClient)),
      context.queryClient.ensureQueryData(adminAssignmentsListQueryOptions(context.apiClient)),
    ]);
  },
  pendingComponent: () => <AdminSectionSkeleton rows={6} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminProjectsPage,
});

function AdminProjectsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · projects
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Projects
        </h1>
      </header>
      <ProjectsAdminSection />
    </div>
  );
}
