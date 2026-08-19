import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components";
import { ApplicationsAdminSection } from "@/components/admin/applications-section";
import { ContributorsAdminSection } from "@/components/admin/contributors-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          people · builders
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Builders
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          People who do project work. Assign them from a project page; manage profiles here.
        </p>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({
            search: { tab: value === "incoming" ? "incoming" : undefined },
            replace: true,
          });
        }}
      >
        <TabsList variant="line" className="font-mono text-[11px] uppercase tracking-[0.18em]">
          <TabsTrigger value="directory">active</TabsTrigger>
          <TabsTrigger value="incoming">applications</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="mt-6">
          <ContributorsAdminSection />
        </TabsContent>
        <TabsContent value="incoming" className="mt-6">
          <ApplicationsAdminSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
