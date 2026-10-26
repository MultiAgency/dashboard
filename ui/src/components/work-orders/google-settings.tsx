import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle, Button, FieldGroup, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;

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
  if (!google.available) {
    return (
      <Alert>
        <AlertTitle>Google Docs isn't set up on this server</AlertTitle>
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
          Google Docs and Drive
        </h3>
        <p className="text-sm text-muted-foreground">
          In a Shared Drive, add{" "}
          <code className="font-mono text-xs break-all text-foreground">
            {google.serviceAccountEmail}
          </code>{" "}
          as a Content manager. MultiAgency fills your template there when you create a work order,
          and saves the signed PDF, with its signature certificate, to the Signed folder.
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
            helper="Where the signed PDFs are saved."
          >
            <Input
              id="google-signed"
              placeholder="https://drive.google.com/drive/folders/…"
              value={signed}
              onChange={(e) => setSigned(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" size="sm" className="self-start" disabled={save.isPending}>
          Save
        </Button>
      </form>
      {google.lastError && (
        <Alert>
          <AlertTitle>Google</AlertTitle>
          <AlertDescription>{google.lastError}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
