import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useApiClient } from "@/lib/api";
import { adminWorkOrdersQueryKey } from "@/lib/queries";
import { OpenDocumentButton } from "./open-document-button";
import type { WorkOrderDetail } from "./work-order-status";

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
        <CardDescription>
          Offering the work order sends it for e-signature: the builder signs first, then the
          representative. A payout account this Agency hasn't paid before is confirmed by its
          wallet.
        </CardDescription>
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
  if (builder && representative) {
    return (
      <span>
        Signed by {builder.name} on {day(builder.signedAt)} and countersigned by{" "}
        {representative.name} on {day(representative.signedAt)}.
      </span>
    );
  }
  if (builder && esign?.sent) {
    return (
      <div className="flex flex-col gap-3">
        <span>
          Signed by {builder.name} in Documenso on {day(builder.signedAt)}.{" "}
          {canManage
            ? "Documenso emailed the representative to countersign."
            : "Waiting for the representative's countersignature."}
        </span>
        {esignError}
        <div className="flex flex-wrap gap-2">
          {canManage && esign.representativeUrl && (
            <Button size="sm" asChild>
              <a href={esign.representativeUrl} target="_blank" rel="noreferrer">
                Countersign in Documenso
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
  if (wo.status === "offered" && esign?.sent) {
    return (
      <div className="flex flex-col gap-3">
        <span className="text-muted-foreground">
          Sent through Documenso on {day(wo.offeredAt)}: it emailed the builder a signing request.
          Waiting for their signature; you're asked to countersign after them.
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
        Not sent yet. Offer to builder prepares the document and sends the builder a signing
        request.
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
  const sent = wo.status !== "draft" || wo.signing.documentSha256 !== null;
  const link = wo.documentSha256 ? wo.documentUrl : (wo.signature.preparedDocumentUrl ?? null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(sent || link) && (
        <OpenDocumentButton
          href={link}
          load={() => apiClient.workOrders.document({ id: wo.id })}
          label={wo.documentSha256 ? "Open the signed document" : "Open document"}
        />
      )}
      {canManage && wo.status === "draft" && (
        <Button size="sm" variant="ghost" onClick={onAttach}>
          Attach a signed PDF by hand
        </Button>
      )}
      {!sent && !link && <span className="text-muted-foreground">Prepared when you offer it.</span>}
    </div>
  );
}
