import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EngagementStatusBadge, type EngagementView } from "@/components/engagement-status";
import { useApiClient } from "@/lib/api";
import { canReadEngagement, isManager } from "@/lib/navigation";
import { engagementsListQueryOptions, refreshAfter } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/")({
  head: () => ({
    meta: [
      { title: "Agencies" },
      { name: "description", content: "The Agencies that work for your Organization." },
    ],
  }),
  component: AgenciesPage,
});

function AgenciesPage() {
  const apiClient = useApiClient();
  const { orgRole } = Route.useRouteContext();
  const engagementsQuery = useQuery(engagementsListQueryOptions(apiClient));
  const engagements = (engagementsQuery.data?.data ?? []).filter((e) => e.side === "client");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          as client · agencies
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Agencies
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every Agency your Organization works with, through an Engagement. Open one to follow its
          shared Projects, billings and reports.
        </p>
      </header>
      {engagementsQuery.isLoading && <Loading label="Loading engagements" />}
      {engagementsQuery.isError && <AdminError error={engagementsQuery.error} />}
      {engagementsQuery.isSuccess && engagements.length === 0 && (
        <Empty label="No Agency works with your Organization yet." />
      )}
      <div className="space-y-3">
        {engagements.map((engagement) => (
          <EngagementCard
            key={engagement.id}
            engagement={engagement}
            canDecide={isManager(orgRole)}
          />
        ))}
      </div>
    </div>
  );
}

function EngagementCard({
  engagement,
  canDecide,
}: {
  engagement: EngagementView;
  canDecide: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const decide = useMutation({
    mutationFn: (action: "accept" | "decline" | "end") =>
      apiClient.engagements[action]({ id: engagement.id }),
    onSuccess: async (_, action) => {
      await refreshAfter(queryClient, { type: "engagements" });
      toast.success(
        action === "accept"
          ? `You now work with ${engagement.agency.name}`
          : action === "decline"
            ? "Proposal declined"
            : "Engagement ended",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg uppercase font-extrabold">
              {engagement.agency.name}
            </span>
            <EngagementStatusBadge status={engagement.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {engagement.status === "proposed"
              ? `${engagement.agency.name} proposes to work for your Organization.`
              : `${engagement.projectIds.length} shared project${engagement.projectIds.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReadEngagement(engagement.status) && (
            <Button asChild size="sm" variant="outline">
              <Link to="/client/$engagementId" params={{ engagementId: engagement.id }}>
                open →
              </Link>
            </Button>
          )}
          {canDecide && engagement.status === "proposed" && (
            <>
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("accept")}>
                accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => decide.mutate("decline")}
              >
                decline
              </Button>
            </>
          )}
          {canDecide && engagement.status === "active" && (
            <Button size="sm" variant="outline" onClick={() => setConfirmEnd(true)}>
              end
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmEnd}
          onOpenChange={setConfirmEnd}
          title={`End the Engagement with ${engagement.agency.name}?`}
          description="The Agency can no longer share Projects with you through it. What was shared stays visible as read-only history."
          confirmLabel="end engagement"
          destructive
          onConfirm={async () => {
            await decide.mutateAsync("end");
          }}
        />
      </CardContent>
    </Card>
  );
}
