import { createFileRoute, Link } from "@tanstack/react-router";
import { BillingsAdminSection } from "@/components/admin/billings-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { PageHeader } from "@/components/page-header";
import { useMeRoles } from "@/hooks/use-me-roles";
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
  const { agencyDao, isLoaded } = useMeRoles();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billings"
        description={
          <>
            All recorded payouts across projects. Record a new billing on the{" "}
            <Link to="/admin/projects" className="underline underline-offset-2">
              project
            </Link>{" "}
            where the work happened.
          </>
        }
      />
      {isLoaded && !agencyDao ? <ConnectTreasuryPrompt /> : <BillingsAdminSection />}
    </div>
  );
}
