import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs, TabsContent, TabsTrigger } from "@/components";
import { ApplicationsAdminSection } from "@/components/admin/applications-section";
import { ContributorsAdminSection } from "@/components/admin/contributors-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { PageHeader } from "@/components/page-header";
import { ScrollableTabsList } from "@/components/scrollable-tabs-list";
import { adminContributorsListQueryOptions } from "@/lib/queries";

const contributorsSearchSchema = z.object({
  tab: z.enum(["directory", "incoming"]).optional().catch("directory"),
});

export const Route = createFileRoute("/_layout/_authenticated/admin/contributors/")({
  head: () => ({
    meta: [{ title: "Builders | Admin" }],
  }),
  validateSearch: contributorsSearchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminContributorsListQueryOptions(context.apiClient)),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminContributorsPage,
});

function AdminContributorsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab = tab === "incoming" ? "incoming" : "directory";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Builders"
        description="People who do project work. Assign them from a project page; manage profiles and applications here."
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({
            search: { tab: value === "incoming" ? "incoming" : undefined },
            replace: true,
          });
        }}
      >
        <ScrollableTabsList>
          <TabsTrigger value="directory">Active</TabsTrigger>
          <TabsTrigger value="incoming">Applications</TabsTrigger>
        </ScrollableTabsList>
        <TabsContent value="directory">
          <ContributorsAdminSection />
        </TabsContent>
        <TabsContent value="incoming">
          <ApplicationsAdminSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
