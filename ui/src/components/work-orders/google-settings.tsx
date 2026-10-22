import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  FieldGroup,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Field } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;

const OUTCOME: Record<
  Integration["google"]["files"][number]["outcome"],
  { label: string; variant: "outline" | "destructive" | "secondary" | "default" }
> = {
  attached: { label: "Signed", variant: "outline" },
  mismatch: { label: "Terms differ", variant: "destructive" },
  unmatched: { label: "No match", variant: "secondary" },
  error: { label: "Will retry", variant: "default" },
};

export function GoogleDriveSettings({
  data,
  onUpdate,
}: {
  data: Integration;
  onUpdate: (data: Integration) => void;
}) {
  const apiClient = useApiClient();
  const google = data.google;
  const [template, setTemplate] = useState(google.templateUrl ?? "");
  const [documents, setDocuments] = useState(google.documentsFolderUrl ?? "");
  const [signed, setSigned] = useState(google.signedFolderUrl ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiClient.workOrders.saveGoogle({
        templateUrl: template.trim() || null,
        documentsFolderUrl: documents.trim() || null,
        signedFolderUrl: signed.trim() || null,
      }),
    onSuccess: (next) => {
      onUpdate(next);
      toast.success("Google Docs and Drive saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });
  const check = useMutation({
    mutationFn: () => apiClient.workOrders.checkDrive({}),
    onSuccess: (next) => {
      onUpdate(next);
      const r = next.result;
      toast.success(
        r.checked === 0
          ? "No new PDFs in the Signed folder"
          : `${r.checked} new PDF${r.checked === 1 ? "" : "s"}: ${r.attached} signed, ${r.mismatch} with different terms, ${r.unmatched} unmatched${r.error ? `, ${r.error} to retry` : ""}`,
      );
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't check the Signed folder"),
  });

  if (!google.available) {
    return (
      <Alert>
        <AlertTitle>Google e-signature isn't set up on this server</AlertTitle>
        <AlertDescription>
          Create a Google Cloud service account with the Drive and Docs APIs enabled, and put its
          JSON key in GOOGLE_SERVICE_ACCOUNT_JSON.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wo-google">
      <div className="flex flex-col gap-1">
        <h3 id="wo-google" className="text-sm font-medium">
          Google Docs and Drive (e-signature)
        </h3>
        <p className="text-sm text-muted-foreground">
          In a Shared Drive, add{" "}
          <code className="font-mono text-xs break-all text-foreground">
            {google.serviceAccountEmail}
          </code>{" "}
          as a Content manager. MultiAgency fills your template there for each work order. After
          both parties sign in Google Docs (Tools → eSignature), save the signed PDF in the Signed
          folder: it's checked against the terms and attached.
        </p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FieldGroup>
          <Field
            label="Template (Google Doc)"
            htmlFor="google-template"
            helper="Placeholders like {{work_order_id}}, {{payee_account}}, {{budget_usd}}."
          >
            <Input
              id="google-template"
              placeholder="https://docs.google.com/document/d/…"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
          </Field>
          <Field
            label="Folder for the filled documents"
            htmlFor="google-documents"
            helper="Inside the Shared Drive."
          >
            <Input
              id="google-documents"
              placeholder="https://drive.google.com/drive/folders/…"
              value={documents}
              onChange={(e) => setDocuments(e.target.value)}
            />
          </Field>
          <Field
            label="Signed folder"
            htmlFor="google-signed"
            helper="Where signed PDFs are saved."
          >
            <Input
              id="google-signed"
              placeholder="https://drive.google.com/drive/folders/…"
              value={signed}
              onChange={(e) => setSigned(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            Save
          </Button>
          {google.signedFolderUrl && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? "Checking…" : "Check the Signed folder now"}
            </Button>
          )}
        </div>
      </form>
      {google.lastError && (
        <Alert>
          <AlertTitle>Google</AlertTitle>
          <AlertDescription>{google.lastError}</AlertDescription>
        </Alert>
      )}
      {google.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Signed folder last checked {google.checkedAt.slice(0, 16).replace("T", " ")}; it's also
          checked on every scheduled run.
        </p>
      )}
      {google.files.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Signed PDF</TableHead>
              <TableHead scope="col">Result</TableHead>
              <TableHead scope="col">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {google.files.map((f) => (
              <TableRow key={f.fileId}>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col gap-1">
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-4 hover:underline"
                      >
                        {f.name}
                      </a>
                    ) : (
                      f.name
                    )}
                    {f.workOrderId && (
                      <Link
                        to="/admin/work-orders/$id"
                        params={{ id: f.workOrderId }}
                        className="text-xs text-muted-foreground underline underline-offset-4"
                      >
                        Open the work order
                      </Link>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col gap-1">
                    <Badge variant={OUTCOME[f.outcome].variant}>{OUTCOME[f.outcome].label}</Badge>
                    {f.note && <span className="text-xs text-muted-foreground">{f.note}</span>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {f.processedAt.slice(0, 16).replace("T", " ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
