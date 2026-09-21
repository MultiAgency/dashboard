import { createFileRoute } from "@tanstack/react-router";
import { EngagementsAdminSection } from "@/components/admin/engagements-section";
import { AdminSectionError, AdminSectionSkeleton } from "@/components/admin-section-states";
import { engagementsListQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/engagements/")({
  head: () => ({
    meta: [{ title: "Engagements | Admin" }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(engagementsListQueryOptions(context.apiClient)),
  pendingComponent: () => <AdminSectionSkeleton rows={5} />,
  errorComponent: ({ error, reset }) => <AdminSectionError error={error} onRetry={reset} />,
  component: AdminEngagementsPage,
});

function AdminEngagementsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          people · engagements
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Engagements
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          The clients you work for and the agencies you hire. Share projects with a client through
          its engagement; each client sees the whole project.
        </p>
      </header>
      <EngagementsAdminSection />
    </div>
  );
}
