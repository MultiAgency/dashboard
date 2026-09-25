import { createFileRoute } from "@tanstack/react-router";
import { BillingsAdminSection } from "@/components/admin/billings-section";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/billings")({
  component: EngagementBillings,
});

function EngagementBillings() {
  const { engagement } = Route.useRouteContext();
  return (
    <section className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        Every billing on the Projects {engagement.agency.name} shares with you.
      </p>
      <BillingsAdminSection readOnly engagementId={engagement.id} />
    </section>
  );
}
