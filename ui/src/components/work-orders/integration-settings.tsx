import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldGroup,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field, Loading } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { type ApiClient, useApiClient } from "@/lib/api";
import { workOrderIntegrationQueryOptions } from "@/lib/queries";
import { GoogleDriveSettings } from "./google-settings";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate border bg-muted px-2 py-1.5 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            navigator.clipboard
              .writeText(value)
              .then(() => toast.success(`${label} copied`))
              .catch(() => toast.error("Couldn't copy"))
          }
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

function deliveryState(d: Integration["deliveries"][number]) {
  if (d.deliveredAt) return <Badge variant="outline">Delivered</Badge>;
  if (d.lastError) return <Badge variant="destructive">Retrying</Badge>;
  return <Badge variant="secondary">Queued</Badge>;
}

export function WorkOrderIntegrationSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const query = useQuery(workOrderIntegrationQueryOptions(apiClient));
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [rotating, setRotating] = useState(false);

  const done = (data: Integration & { inboundToken?: string | null }) => {
    queryClient.setQueryData(workOrderIntegrationQueryOptions(apiClient).queryKey, data);
    if (data.inboundToken) setToken(data.inboundToken);
  };
  const save = useMutation({
    mutationFn: (url: string | null) => apiClient.workOrders.saveIntegration({ webhookUrl: url }),
    onSuccess: (data) => {
      done(data);
      setWebhookUrl(null);
      toast.success(data.webhookUrl ? "n8n connected" : "n8n disconnected");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });
  const rotate = useMutation({
    mutationFn: () => apiClient.workOrders.rotateIntegration({}),
    onSuccess: (data) => {
      done(data);
      toast.success("New token and secret issued: update both in n8n");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't rotate"),
  });
  const test = useMutation({
    mutationFn: () => apiClient.workOrders.testIntegration({}),
    onSuccess: (data) => {
      done(data);
      const last = data.deliveries[0];
      if (last?.deliveredAt) toast.success("n8n received the test event");
      else toast.error(last?.lastError ?? "n8n didn't confirm the test event");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't send a test event"),
  });

  if (query.isLoading) return <Loading label="Loading the work order integration" />;
  if (query.isError || !query.data) return <AdminError error={query.error} />;
  const data = query.data;
  const editing = webhookUrl ?? data.webhookUrl ?? "";
  const busy = save.isPending || rotate.isPending || test.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Work orders: email and e-signature</h2>
        </CardTitle>
        <CardDescription>
          MultiAgency emails builders and your representative at each step of a work order, fills
          your Google Docs template and attaches the e-signed PDFs from your Drive.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant={data.connected || data.emailEnabled ? "outline" : "destructive"}>
            {data.connected
              ? "Email through n8n (Gmail)"
              : data.emailEnabled
                ? "Email on (Resend)"
                : "Email off"}
          </Badge>
          <Badge variant={data.connected ? "outline" : "secondary"}>
            {data.connected ? "n8n connected" : "n8n not connected"}
          </Badge>
          <Badge variant={data.aiDraftsEnabled ? "outline" : "secondary"}>
            {data.aiDraftsEnabled ? "AI report drafts on" : "AI report drafts off"}
          </Badge>
        </div>
        {!data.connected && !data.emailEnabled && (
          <Alert>
            <AlertTitle>Emails are off on this server</AlertTitle>
            <AlertDescription>
              Set RESEND_API_KEY and NOTIFY_FROM_EMAIL. Until then people get in-app notifications
              only.
            </AlertDescription>
          </Alert>
        )}

        {data.google && <GoogleDriveSettings data={data} onUpdate={done} />}

        <form
          className="flex flex-col gap-4 border-t pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(editing.trim() || null);
          }}
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">n8n (optional)</h3>
            <p className="text-sm text-muted-foreground">
              Only if your emails should go out from your own Gmail through n8n instead.
            </p>
          </div>
          <FieldGroup>
            <Field
              label="n8n webhook URL"
              htmlFor="n8n-webhook"
              helper="The Production URL of the work order events workflow."
            >
              <Input
                id="n8n-webhook"
                type="url"
                placeholder="https://your-n8n/webhook/…"
                value={editing}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {data.hasInboundToken ? "Save" : "Connect"}
            </Button>
            {data.connected && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => test.mutate()}
              >
                Send a test event
              </Button>
            )}
          </div>
        </form>

        {token && (
          <Alert>
            <AlertTitle>Copy the token now</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>
                It's shown once. In n8n, set the Header Auth credential to name Authorization and
                value Bearer followed by this token.
              </span>
              <CopyValue label="Token" value={token} />
            </AlertDescription>
          </Alert>
        )}

        {data.hasInboundToken && (
          <div className="flex flex-col gap-4">
            <CopyValue
              label="Callback base URL (PUBLIC_URL in the workflows)"
              value={data.callbackBaseUrl}
            />
            {data.webhookSecret &&
              (showSecret ? (
                <CopyValue label="Webhook signing secret" value={data.webhookSecret} />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => setShowSecret(true)}
                >
                  Show the webhook signing secret
                </Button>
              ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={busy}
              onClick={() => setRotating(true)}
            >
              Issue a new token and secret
            </Button>
          </div>
        )}

        {data.deliveries.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="wo-deliveries">
            <h3 id="wo-deliveries" className="text-sm font-medium">
              Recent deliveries
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Event</TableHead>
                  <TableHead scope="col">To</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                    <TableCell>{d.channel === "email" ? "Email" : "n8n"}</TableCell>
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
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title="Issue a new token and secret?"
        description="The current ones stop working at once. Update the Header Auth credential and the signature check in n8n."
        confirmLabel="Issue new ones"
        destructive
        onConfirm={() => rotate.mutateAsync().then(() => undefined)}
      />
    </Card>
  );
}
