import { createFileRoute } from "@tanstack/react-router";
import { ProjectsAdminSection } from "@/components/admin/projects-section";
import { SharedWithUsSection } from "@/components/admin/shared-with-us-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { PageHeader } from "@/components/page-header";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Each project holds the team, budget and billings for work you deliver to clients."
      />
      <ProjectsAdminSection />
      <SharedWithUsSection />
    </div>
  );
}
