import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientsAdminSection } from "@/components/admin/clients-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { adminClientsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/clients/")({
  head: () => ({
    meta: [{ title: "Clients | Admin" }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminClientsListQueryOptions(context.apiClient)),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminClientsPage,
});

function AdminClientsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          people · clients
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Clients
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Paying customers — link them to projects and set their NEAR wallet for the read-only
          client portal. Agency staff are managed under{" "}
          <Link to="/admin/members" className="underline underline-offset-2 hover:text-foreground">
            Team
          </Link>
          .
        </p>
      </header>
      <ClientsAdminSection />
    </div>
  );
}
