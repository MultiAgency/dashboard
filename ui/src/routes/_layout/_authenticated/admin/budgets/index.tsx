import { createFileRoute, Link } from "@tanstack/react-router";
import { BudgetsManager } from "@/components/admin/budgets-manager";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { ConnectTreasuryPrompt } from "@/components/connect-treasury-prompt";
import { PageHeader } from "@/components/page-header";
import { useMeRoles } from "@/hooks/use-me-roles";
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
  const { agencyDao, isLoaded } = useMeRoles();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Budgets"
        description={
          <>
            Cross-project budget transfers and treasury views. Day-to-day allocations happen on each{" "}
            <Link to="/admin/projects" className="underline underline-offset-2">
              project page
            </Link>
            .
          </>
        }
      />
      {isLoaded && !agencyDao ? <ConnectTreasuryPrompt /> : <BudgetsManager />}
    </div>
  );
}
