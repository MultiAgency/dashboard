import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryKey, workOrderIntegrationQueryOptions } from "@/lib/queries";
import type { WorkOrderDetail } from "./work-order-status";

const ROLE_LABEL = { contractor: "Builder", representative: "Representative" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function SigningPanel({
  workOrder: wo,
  canManage,
  onAttach,
}: {
  workOrder: WorkOrderDetail;
  canManage: boolean;
  onAttach: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const integration = useQuery({
    ...workOrderIntegrationQueryOptions(apiClient),
    enabled: canManage,
  }).data;
  const [github, setGithub] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });

  const saveGithub = useMutation({
    mutationFn: () => apiClient.workOrders.setGithubLogin({ id: wo.id, githubLogin: github }),
    onSuccess: async () => {
      await refresh();
      setGithub("");
      toast.success("GitHub login saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save the GitHub login"),
  });
  const prepare = useMutation({
    mutationFn: () => apiClient.workOrders.prepareDocument({ id: wo.id }),
    onSuccess: () => toast.success("Sent to n8n: the filled document and its email follow"),
    onError: (err: Error) => toast.error(err.message || "Couldn't send it to n8n"),
  });
  const askPayee = useMutation({
    mutationFn: () => apiClient.workOrders.requestPayeeConfirmation({ id: wo.id }),
    onSuccess: async () => {
      await refresh();
      toast.success("The builder was asked to confirm the payout account");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't send the request"),
  });

  const signature = wo.signature;
  const unsigned = wo.status === "draft" || wo.status === "offered";
  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Signature and payout account</h2>
        </CardTitle>
        <CardDescription>
          The builder either e-signs the work order document in Google Docs or accepts the terms in
          MultiAgency. A payout account this Agency hasn't paid before is confirmed by its wallet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[10rem_1fr]">
          <Row label="Signature">
            {signature.method === "google_esign" ? (
              <div className="flex flex-col gap-1">
                <span>E-signed in Google Docs on {date(signature.signedAt)}</span>
                {signature.signers.length > 0 && (
                  <ul className="text-muted-foreground">
                    {signature.signers.map((s) => (
                      <li key={`${s.role}-${s.name}`}>
                        {ROLE_LABEL[s.role]}: {s.name}
                        {s.signedAt ? `, ${date(s.signedAt)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : signature.method === "in_app" ? (
              <span>Accepted by the builder in MultiAgency on {date(signature.signedAt)}</span>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground">Not signed yet.</span>
                {signature.preparedDocumentUrl ? (
                  <Button size="sm" className="self-start" asChild>
                    <a href={signature.preparedDocumentUrl} target="_blank" rel="noreferrer">
                      Open the document to send for signature
                    </a>
                  </Button>
                ) : canManage && integration && !integration.connected ? (
                  <span className="text-muted-foreground">
                    <Link
                      to="/admin/settings"
                      hash="work-orders"
                      className="text-foreground underline underline-offset-4"
                    >
                      Connect n8n
                    </Link>{" "}
                    to fill your Google Docs template, or offer it to the builder to accept in
                    MultiAgency.
                  </span>
                ) : (
                  canManage && (
                    <span className="text-muted-foreground">
                      The filled document arrives from n8n. Then: Google Docs → Tools → eSignature →
                      Request signature, and save the signed PDF in your Signed folder.
                    </span>
                  )
                )}
                {canManage && integration?.connected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    disabled={prepare.isPending}
                    onClick={() => prepare.mutate()}
                  >
                    {signature.preparedDocumentUrl
                      ? "Fill the document again"
                      : "Fill the document in Google Docs"}
                  </Button>
                )}
              </div>
            )}
          </Row>
          <Row label="Signed document">
            <span className="flex flex-wrap items-center gap-2">
              {wo.documentSha256 ? (
                <span className="font-mono text-xs break-all">
                  {wo.documentUrl ? (
                    <a
                      href={wo.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      SHA-256 {wo.documentSha256.slice(0, 16)}…
                    </a>
                  ) : (
                    `SHA-256 ${wo.documentSha256.slice(0, 16)}…`
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {unsigned ? "Attached automatically when the signed PDF lands in Drive" : "None"}
                </span>
              )}
              {canManage && wo.status !== "terminated" && signature.method !== "google_esign" && (
                <Button size="sm" variant="ghost" onClick={onAttach}>
                  Attach by hand
                </Button>
              )}
            </span>
          </Row>
          <Row label="Payout account">
            <div className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{wo.payee.account}</span>
                {wo.payee.confirmedAt ? (
                  <Badge variant="outline">Confirmed {date(wo.payee.confirmedAt)}</Badge>
                ) : wo.payee.paidBefore ? (
                  <Badge variant="outline">Paid by this Agency before</Badge>
                ) : wo.payee.needsConfirmation ? (
                  <Badge>Needs the builder's confirmation</Badge>
                ) : null}
              </span>
              {wo.payee.needsConfirmation && (
                <span className="text-muted-foreground">
                  This Agency hasn't paid this account before, so the builder confirms it by signing
                  in with that NEAR wallet. Accepting in MultiAgency confirms it too.
                </span>
              )}
              {canManage && wo.payee.needsConfirmation && wo.status !== "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={askPayee.isPending}
                  onClick={() => askPayee.mutate()}
                >
                  Ask the builder to confirm
                </Button>
              )}
            </div>
          </Row>
          <Row label="GitHub login">
            {wo.builder.githubLogin ? (
              <a
                href={`https://github.com/${wo.builder.githubLogin}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline-offset-4 hover:underline"
              >
                @{wo.builder.githubLogin}
              </a>
            ) : canManage ? (
              <form
                className="flex max-w-sm items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (github.trim()) saveGithub.mutate();
                }}
              >
                <Input
                  aria-label="GitHub login"
                  placeholder={wo.builder.profileGithubLogin ?? "Missing: add it"}
                  value={github}
                  onChange={(e) => setGithub(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={!github.trim() || saveGithub.isPending}>
                  Add
                </Button>
              </form>
            ) : (
              <span className="text-destructive">Missing</span>
            )}
          </Row>
          <Row label="Builder's email">
            {wo.contractorEmail ?? (
              <span className="text-muted-foreground">Their MultiAgency account email, if any</span>
            )}
          </Row>
          <Row label="Representative">
            {wo.representativeName ?? <span className="text-muted-foreground">Not set</span>}
            {wo.representativeEmail ? (
              <span className="text-muted-foreground"> · {wo.representativeEmail}</span>
            ) : null}
          </Row>
          {wo.ipModel && <Row label="IP model">{wo.ipModel.replace("_", " ")}</Row>}
        </dl>
      </CardContent>
    </Card>
  );
}
