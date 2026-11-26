import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Badge, Card, CardContent } from "@/components";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { useApiClient } from "@/lib/api";
import { oldPayoutPathQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/platform/old-payouts")({
  head: () => ({
    meta: [{ title: "Old payout path | Platform" }],
  }),
  component: OldPayoutPath,
});

function OldPayoutPath() {
  const apiClient = useApiClient();
  const query = useQuery(oldPayoutPathQueryOptions(apiClient));
  const data = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Old payout path"
        description="Before the dashboard's direct payout agent is removed, every Organization pays through its platform agent and nothing on the old path is still open."
      />
      {query.isError && (
        <LoadError title="Couldn't read the old payout path" onRetry={() => void query.refetch()} />
      )}
      {data && (
        <Alert variant={data.drained ? "default" : "destructive"}>
          <AlertTitle>{data.drained ? "Drained" : "Not drained yet"}</AlertTitle>
          <AlertDescription>
            {data.drained
              ? "Nothing on the old path is open, and no Organization still pays through it."
              : "The Organizations below still have something on the old path. Each one is resolved there first."}
          </AlertDescription>
        </Alert>
      )}
      {data?.organizations.map((o) => (
        <Card key={o.organizationId}>
          <CardContent className="flex flex-col gap-2 pt-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{o.name ?? o.organizationId}</span>
              <Badge variant="outline">
                pays through {o.route === "platform" ? "the platform" : "the old agent"}
              </Badge>
              {o.blockers.length === 0 && <Badge variant="secondary">drained</Badge>}
            </div>
            <span className="text-muted-foreground">
              {o.oldAgentId
                ? `Old agent ${o.oldAgentId}, owned by ${o.ownerAccountId}`
                : "No old agent"}{" "}
              · {o.unsettledPayouts} unsettled old payouts · {o.ownerActionsInFlight} old owner
              actions in flight
            </span>
            {o.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-destructive">
                {o.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {o.grantLiveUntil && (
              <span>
                The old payout permission is live until{" "}
                {new Date(o.grantLiveUntil).toLocaleDateString()}. The owner can revoke it with
                their wallet; it isn't used once the old path is removed.
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
