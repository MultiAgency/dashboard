import { createFileRoute } from "@tanstack/react-router";
import { PrepaidBalanceCard, PrepaymentTable } from "@/components/prepayments";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/prepayments")({
  component: EngagementPrepayments,
});

function EngagementPrepayments() {
  const { engagement } = Route.useRouteContext();
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Every Prepayment {engagement.agency.name} recorded for you. Your Prepaid balance is what you
        prepaid minus what went into Project budgets; it rolls over from month to month.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PrepaidBalanceCard engagementId={engagement.id} />
      </div>
      <PrepaymentTable engagementId={engagement.id} />
    </section>
  );
}
