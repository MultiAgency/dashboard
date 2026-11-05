import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Loading } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { workOrderIntegrationQueryOptions } from "@/lib/queries";
import { GoogleDriveSettings } from "./google-settings";
import { OperatorHint } from "./operator-hint";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;

function deliveryState(d: Integration["deliveries"][number]) {
  if (d.deliveredAt) return <Badge variant="outline">Delivered</Badge>;
  if (d.lastError) return <Badge variant="destructive">Retrying</Badge>;
  return <Badge variant="secondary">Queued</Badge>;
}

export function WorkOrderIntegrationSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(workOrderIntegrationQueryOptions(apiClient));

  const done = (data: Integration) =>
    queryClient.setQueryData(workOrderIntegrationQueryOptions(apiClient).queryKey, data);

  if (query.isLoading) return <Loading label="Loading the work order settings" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const data = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Work orders: documents and email</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant={data.emailEnabled ? "outline" : "destructive"}>
            {data.emailEnabled ? "Email on" : "Email off"}
          </Badge>
          <Badge variant={data.aiDraftsEnabled ? "outline" : "secondary"}>
            {data.aiDraftsEnabled ? "AI report drafts on" : "AI report drafts off"}
          </Badge>
        </div>
        {!data.emailEnabled && (
          <Alert>
            <AlertTitle>Emails are off on this server</AlertTitle>
            <AlertDescription>
              <OperatorHint>Set RESEND_API_KEY and NOTIFY_FROM_EMAIL.</OperatorHint> Until then,
              notifications are in-app only.
            </AlertDescription>
          </Alert>
        )}

        {data.google && <GoogleDriveSettings data={data} onUpdate={done} />}

        {data.deliveries.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-6" aria-labelledby="wo-deliveries">
            <h3 id="wo-deliveries" className="text-sm font-medium">
              Recent emails
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Event</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-col gap-1">
                        {deliveryState(d)}
                        {!d.deliveredAt && d.lastError && (
                          <span className="text-xs text-muted-foreground">{d.lastError}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {d.createdAt.slice(0, 16).replace("T", " ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
