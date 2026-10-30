import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryKey } from "@/lib/queries";
import { OpenDocumentButton } from "./open-document-button";
import { payeeConfirmedBySigning, type WorkOrderDetail } from "./work-order-status";

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
  const confirmsOnSigning = payeeConfirmedBySigning(wo);
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
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
  const askPayee = useMutation({
    mutationFn: () => apiClient.workOrders.requestPayeeConfirmation({ id: wo.id }),
    onSuccess: async () => {
      await refresh();
      toast.success("The builder was asked to confirm the payout account");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't send the request"),
  });

  const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Signature and payout account</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[10rem_1fr]">
          <Row label="Signature">
            <SignatureStatus workOrder={wo} canManage={canManage} />
          </Row>
          <Row label="Document">
            <DocumentRow workOrder={wo} canManage={canManage} onAttach={onAttach} />
          </Row>
          <Row label="Payout account">
            <div className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{wo.payee.account}</span>
                {wo.payee.confirmedAt ? (
                  <Badge variant="outline">Confirmed {date(wo.payee.confirmedAt)}</Badge>
                ) : wo.payee.paidBefore ? (
                  <Badge variant="outline">Paid by this Agency before</Badge>
                ) : confirmsOnSigning ? (
                  <span className="text-muted-foreground">Confirmed when they sign</span>
                ) : wo.payee.needsConfirmation ? (
                  <Badge>Needs the builder's confirmation</Badge>
                ) : null}
              </span>
              {wo.payee.needsConfirmation && !confirmsOnSigning && (
                <span className="text-muted-foreground">
                  New account: the builder confirms it by signing in with that NEAR wallet.
                </span>
              )}
              {canManage &&
                wo.payee.needsConfirmation &&
                !confirmsOnSigning &&
                wo.status !== "draft" && (
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
        </dl>
      </CardContent>
    </Card>
  );
}

function SignatureStatus({
  workOrder: wo,
  canManage,
}: {
  workOrder: WorkOrderDetail;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(wo.representativeName ?? "");
  const [agree, setAgree] = useState(false);
  const countersign = useMutation({
    mutationFn: () =>
      apiClient.workOrders.countersign({ id: wo.id, name: name.trim(), agree: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success("Countersigned: the signed PDF is saved and sent to both of you");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't countersign"),
  });
  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
  const { builder, representative, esign } = wo.signing;
  const check = () => queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
  const esignError = esign?.error ? <span className="text-destructive">{esign.error}</span> : null;

  if (wo.signature.method === "google_esign") {
    return (
      <div className="flex flex-col gap-1">
        <span>E-signed in Google Docs on {day(wo.signature.signedAt)}</span>
        {wo.signature.signers.map((s) => (
          <span key={`${s.role}-${s.name}`} className="text-muted-foreground">
            {s.role === "contractor" ? "Builder" : "Representative"}: {s.name}
          </span>
        ))}
      </div>
    );
  }
  if (builder && representative && wo.signature.method === "documenso") {
    return (
      <span>
        Signed in Documenso by {representative.name} on {day(representative.signedAt)} and by{" "}
        {builder.name} on {day(builder.signedAt)}.
      </span>
    );
  }
  if (builder && representative) {
    return (
      <span>
        Signed by {builder.name} on {day(builder.signedAt)} and countersigned by{" "}
        {representative.name} on {day(representative.signedAt)}.
      </span>
    );
  }
  if (builder) {
    return (
      <div className="flex flex-col gap-3">
        <span>
          Signed by {builder.name} on {day(builder.signedAt)}.{" "}
          {canManage
            ? "Countersign it to complete the work order."
            : "Waiting for a countersignature."}
        </span>
        {canManage && (
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (agree && name.trim().length >= 2) countersign.mutate();
            }}
          >
            <Input
              aria-label="Your full name"
              placeholder="Your full name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor={`countersign-${wo.id}`} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`countersign-${wo.id}`}
                checked={agree}
                onCheckedChange={(checked) => setAgree(checked === true)}
              />
              <span>
                I've read this work order and sign it electronically for the Agency. My typed name
                is my signature.
              </span>
            </label>
            <Button
              type="submit"
              size="sm"
              className="self-start"
              disabled={!agree || name.trim().length < 2 || countersign.isPending}
            >
              {countersign.isPending ? "Signing…" : "Countersign"}
            </Button>
          </form>
        )}
      </div>
    );
  }
  if (wo.status === "offered" && esign?.sent && wo.signing.awaitingRepresentative) {
    return (
      <div className="flex flex-col gap-3">
        <span>
          {canManage
            ? "Sign it in Documenso to send it to the builder."
            : `Waiting for ${wo.representativeName ?? "the representative"} to sign it in Documenso.`}
        </span>
        {esignError}
        <div className="flex flex-wrap gap-2">
          {canManage && esign.representativeUrl && (
            <Button size="sm" asChild>
              <a href={esign.representativeUrl} target="_blank" rel="noreferrer">
                {wo.representativeName
                  ? `Sign as ${wo.representativeName} to send it`
                  : "Sign in Documenso to send it"}
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={check}>
            Check signatures
          </Button>
        </div>
      </div>
    );
  }
  if (wo.status === "offered" && esign?.sent) {
    const builderName = wo.contractorName ?? wo.builder.name ?? wo.builder.nearAccount;
    return (
      <div className="flex flex-col gap-3">
        <span className="text-muted-foreground">
          {representative ? `Signed by ${representative.name}. ` : ""}Sent to {builderName} on{" "}
          {day(representative?.signedAt ?? wo.offeredAt)}; waiting for their signature.
        </span>
        {esignError}
        <Button size="sm" variant="outline" className="self-start" onClick={check}>
          Check signatures
        </Button>
      </div>
    );
  }
  if (wo.status === "offered") {
    return (
      <span className="text-muted-foreground">
        Sent to the builder on {day(wo.offeredAt)}; waiting for their signature.
      </span>
    );
  }
  if (wo.signature.method === "in_app" && wo.acceptedAt) {
    return <span>Accepted by the builder in MultiAgency on {day(wo.acceptedAt)}.</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground">
        Not sent yet. When offered, the representative signs first, then the builder.
      </span>
      {esignError}
    </div>
  );
}

function DocumentRow({
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
  const retryDrive = useMutation({
    mutationFn: () => apiClient.workOrders.saveSignedToDrive({ id: wo.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminWorkOrdersQueryKey });
      toast.success("Saved to Google Drive");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save it to Google Drive"),
  });
  const sent = wo.status !== "draft" || wo.signing.documentSha256 !== null;
  const link = wo.documentSha256 ? wo.documentUrl : (wo.signature.preparedDocumentUrl ?? null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {(sent || link) && (
          <OpenDocumentButton
            href={link}
            load={() => apiClient.workOrders.document({ id: wo.id })}
            label={wo.documentSha256 ? "Open the signed document" : "Open document"}
          />
        )}
        {wo.signature.driveUrl && (
          <a
            href={wo.signature.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline-offset-4 hover:underline"
          >
            Saved to Google Drive
          </a>
        )}
        {canManage && wo.status === "draft" && (
          <Button size="sm" variant="ghost" onClick={onAttach}>
            Attach a signed PDF by hand
          </Button>
        )}
        {!sent && !link && (
          <span className="text-muted-foreground">Prepared when you offer it.</span>
        )}
      </div>
      {wo.signature.driveError && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-destructive">{wo.signature.driveError}</span>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={retryDrive.isPending}
              onClick={() => retryDrive.mutate()}
            >
              Retry upload
            </Button>
          )}
        </div>
      )}
      {wo.signature.documentWarning && (
        <span className="text-muted-foreground">{wo.signature.documentWarning}</span>
      )}
    </div>
  );
}
