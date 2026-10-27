import { CaretRightIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle, Button, FieldGroup, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { type ApiClient, useApiClient } from "@/lib/api";
import { pickFromDrive } from "@/lib/google-picker";
import { TemplateFields } from "./template-fields";

type Integration = Awaited<ReturnType<ApiClient["workOrders"]["integration"]>>;
type Slot = "template" | "documents" | "signed";

const SLOTS: { slot: Slot; label: string; kind: "document" | "folder"; empty: string }[] = [
  { slot: "template", label: "Template", kind: "document", empty: "Choose template" },
  {
    slot: "documents",
    label: "Documents folder",
    kind: "folder",
    empty: "Choose documents folder",
  },
  { slot: "signed", label: "Signed folder", kind: "folder", empty: "Choose signed folder" },
];

function useConnectResult() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") toast.success("Google Drive connected");
    else toast.error(params.get("message") || "Google Drive couldn't be connected");
    params.delete("google");
    params.delete("message");
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
  }, []);
}

export function GoogleDriveSettings({
  data,
  onUpdate,
}: {
  data: Integration;
  onUpdate: (data: Integration) => void;
}) {
  useConnectResult();
  const apiClient = useApiClient();
  const google = data.google;
  const oauth = google.oauth;
  const [template, setTemplate] = useState(google.templateUrl ?? "");
  const [documents, setDocuments] = useState(google.documentsFolderUrl ?? "");
  const [signed, setSigned] = useState(google.signedFolderUrl ?? "");

  useEffect(() => {
    setTemplate(google.templateUrl ?? "");
    setDocuments(google.documentsFolderUrl ?? "");
    setSigned(google.signedFolderUrl ?? "");
  }, [google.templateUrl, google.documentsFolderUrl, google.signedFolderUrl]);

  const current = { template, documents, signed };
  const saveWith = (next: Partial<Record<Slot, string>>) => {
    const values = { ...current, ...next };
    return apiClient.workOrders.saveGoogle({
      templateUrl: values.template.trim() || null,
      documentsFolderUrl: values.documents.trim() || null,
      signedFolderUrl: values.signed.trim() || null,
    });
  };

  const save = useMutation({
    mutationFn: () => saveWith({}),
    onSuccess: (next) => {
      onUpdate(next);
      toast.success("Google Docs and Drive saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
  });
  const connect = useMutation({
    mutationFn: () => apiClient.workOrders.connectGoogle({}),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't start the Google sign-in"),
  });
  const disconnect = useMutation({
    mutationFn: () => apiClient.workOrders.disconnectGoogle({}),
    onSuccess: (next) => {
      onUpdate(next);
      toast.success("Google Drive disconnected");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't disconnect"),
  });
  const choose = useMutation({
    mutationFn: async (slot: (typeof SLOTS)[number]) => {
      const token = await apiClient.workOrders.googlePickerToken({});
      const picked = await pickFromDrive(slot.kind, token);
      if (!picked) return null;
      return saveWith({ [slot.slot]: picked.id });
    },
    onSuccess: (next) => {
      if (!next) return;
      onUpdate(next);
      toast.success("Saved");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't open Google Drive"),
  });
  const starter = useMutation({
    mutationFn: () => apiClient.workOrders.copyStarterTemplate({}),
    onSuccess: (next) => {
      onUpdate(next);
      toast.success("The starter template was copied to your folder and selected");
    },
    onError: (err: Error) => toast.error(err.message || "Couldn't copy the starter template"),
  });

  if (!google.available) {
    return (
      <Alert>
        <AlertTitle>Google Docs isn't set up on this server</AlertTitle>
        <AlertDescription>
          Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET so each Agency can connect its
          own Google Drive, or put a service account's JSON key in GOOGLE_SERVICE_ACCOUNT_JSON.
        </AlertDescription>
      </Alert>
    );
  }

  const connected = oauth.connected && !oauth.error;
  const canPick = connected && oauth.picker;
  const urls: Record<Slot, string | null> = {
    template: google.templateUrl,
    documents: google.documentsFolderUrl,
    signed: google.signedFolderUrl,
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="wo-google">
      <div className="flex flex-col gap-1">
        <h3 id="wo-google" className="text-sm font-medium">
          Google Docs and Drive
        </h3>
        <p className="text-sm text-muted-foreground">
          MultiAgency fills your template in your Drive when you create a work order, and saves the
          signed PDF, with its signature certificate, to the Signed folder.
        </p>
      </div>

      {oauth.available && (
        <div className="flex flex-col gap-2">
          {oauth.connected ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                Connected as{" "}
                <span className="font-medium">{oauth.email ?? "your Google account"}</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="self-start"
              disabled={!oauth.canConnect || connect.isPending}
              onClick={() => connect.mutate()}
            >
              Connect Google Drive
            </Button>
          )}
          {oauth.error && (
            <Alert>
              <AlertTitle>Reconnect Google Drive</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>{oauth.error}</span>
                <Button
                  size="sm"
                  className="self-start"
                  disabled={connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  Reconnect
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!oauth.canConnect && (
            <p className="text-sm text-muted-foreground">
              Set PAYOUTS_SECRET_KEY or GOOGLE_TOKENS_SECRET_KEY on the server so the connection can
              be stored encrypted.
            </p>
          )}
          {!oauth.connected && google.serviceAccountEmail && (
            <p className="text-sm text-muted-foreground">
              Until you connect, MultiAgency uses the server's service account{" "}
              <code className="font-mono text-xs break-all text-foreground">
                {google.serviceAccountEmail}
              </code>
              : share a Shared Drive with it as a Content manager.
            </p>
          )}
        </div>
      )}

      {!oauth.available && google.serviceAccountEmail && (
        <p className="text-sm text-muted-foreground">
          In a Shared Drive, add{" "}
          <code className="font-mono text-xs break-all text-foreground">
            {google.serviceAccountEmail}
          </code>{" "}
          as a Content manager, then paste the links below.
        </p>
      )}

      {canPick && (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          {SLOTS.map((slot) => (
            <div key={slot.slot} className="contents">
              <dt className="text-muted-foreground">{slot.label}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-2">
                {urls[slot.slot] && (
                  <a
                    href={urls[slot.slot] ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate underline-offset-4 hover:underline"
                  >
                    Open
                  </a>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(slot)}
                >
                  {urls[slot.slot] ? "Change" : slot.empty}
                </Button>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {connected && !oauth.picker && (
        <p className="text-sm text-muted-foreground">
          Set GOOGLE_PICKER_API_KEY to choose files from Drive here. Until then, paste the links
          under Advanced.
        </p>
      )}

      {google.starterAvailable && (connected || google.serviceAccountEmail) && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={!google.documentsFolderUrl || starter.isPending}
          onClick={() => starter.mutate()}
        >
          Copy the MultiAgency starter template
        </Button>
      )}

      {google.templateUrl && <TemplateFields data={data} onUpdate={onUpdate} />}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="group/advanced self-start">
            <CaretRightIcon
              aria-hidden
              className="transition-transform group-data-[state=open]/advanced:rotate-90"
            />
            Advanced: paste links
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <form
            className="flex flex-col gap-4 pt-2"
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
                helper={
                  oauth.connected
                    ? "A folder in your Drive."
                    : "Inside the Shared Drive, for the service account."
                }
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
            {oauth.redirectUri && (
              <p className="text-xs text-muted-foreground">
                Google sign-in redirect URI:{" "}
                <code className="font-mono break-all text-foreground">{oauth.redirectUri}</code>
              </p>
            )}
          </form>
        </CollapsibleContent>
      </Collapsible>

      {google.lastError && (
        <Alert>
          <AlertTitle>Google</AlertTitle>
          <AlertDescription>{google.lastError}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
