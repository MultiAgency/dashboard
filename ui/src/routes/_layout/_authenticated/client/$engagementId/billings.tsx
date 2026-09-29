import { createFileRoute } from "@tanstack/react-router";
import { BillingsAdminSection } from "@/components/admin/billings-section";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/billings")({
  component: EngagementBillings,
});

function EngagementBillings() {
  const { engagement } = Route.useRouteContext();
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Every billing on the Projects {engagement.agency.name} shares with you.
      </p>
      <BillingsAdminSection readOnly engagementId={engagement.id} />
    </section>
  );
}
