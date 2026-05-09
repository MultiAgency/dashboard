import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/app";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { sessionQueryKey, sessionQueryOptions, signOut } from "@/lib/session";
import { useApiClient } from "@/lib/use-api-client";

export const Route = createFileRoute("/_layout/_authenticated/_configured/settings")({
  head: () => ({
    meta: [
      { title: "Settings" },
      { name: "description", content: "Manage agency configuration and your session." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const apiClient = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions());

  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();

  const settingsQuery = useQuery({
    queryKey: ["settings", "adminGet"],
    queryFn: () => apiClient.settings.adminGet(),
    retry: false,
  });

  const isAdmin = !!settingsQuery.data;

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryKey, null);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      navigate({ to: "/", replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!user) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Loading settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <Card>
          <CardContent className="p-6 sm:p-8 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">settings</Badge>
              {isAdmin && <Badge variant="outline">admin</Badge>}
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Identity</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connected via NEAR wallet.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/home">back to workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {isAdmin && settingsQuery.data && (
        <AgencyConfigSection initial={settingsQuery.data.settings} />
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
          <p className="text-sm text-muted-foreground">Read-only session identity.</p>
        </div>
        <Card>
          <CardContent className="p-6 grid gap-4">
            <Field label="user id">
              <div className="rounded-sm border border-border bg-muted/10 p-3 font-mono text-xs break-all">
                {user.id}
              </div>
            </Field>
            <Field label="near account">
              <div className="rounded-sm border border-border bg-muted/10 p-3 font-mono text-xs break-all">
                {nearAccountId ?? "not linked"}
              </div>
            </Field>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Session</h2>
          <p className="text-sm text-muted-foreground">Disconnect this session.</p>
        </div>
        <Card>
          <CardContent className="p-5 space-y-3">
            <Button
              onClick={() => signOutMutation.mutate()}
              disabled={signOutMutation.isPending}
              variant="outline"
              size="sm"
            >
              {signOutMutation.isPending ? "signing out..." : "sign out"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

type Settings = {
  daoAccountId: string;
  nearnAccountId: string | null;
  name: string;
  headline: string | null;
  tagline: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  docsUrl: string | null;
  description: string | null;
  metadata: string | null;
  adminRoleName: string | null;
  approverRoleName: string | null;
  requestorRoleName: string | null;
};

function AgencyConfigSection({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [daoAccountId, setDaoAccountId] = useState(initial.daoAccountId);
  const [nearnAccountId, setNearnAccountId] = useState(initial.nearnAccountId ?? "");
  const [name, setName] = useState(initial.name);
  const [headline, setHeadline] = useState(initial.headline ?? "");
  const [tagline, setTagline] = useState(initial.tagline ?? "");
  const [contactEmail, setContactEmail] = useState(initial.contactEmail ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl ?? "");
  const [docsUrl, setDocsUrl] = useState(initial.docsUrl ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [metadata, setMetadata] = useState(initial.metadata ?? "");
  const [adminRoleName, setAdminRoleName] = useState(initial.adminRoleName ?? "");
  const [approverRoleName, setApproverRoleName] = useState(initial.approverRoleName ?? "");
  const [requestorRoleName, setRequestorRoleName] = useState(initial.requestorRoleName ?? "");

  useEffect(() => {
    setDaoAccountId(initial.daoAccountId);
    setNearnAccountId(initial.nearnAccountId ?? "");
    setName(initial.name);
    setHeadline(initial.headline ?? "");
    setTagline(initial.tagline ?? "");
    setContactEmail(initial.contactEmail ?? "");
    setWebsiteUrl(initial.websiteUrl ?? "");
    setDocsUrl(initial.docsUrl ?? "");
    setDescription(initial.description ?? "");
    setMetadata(initial.metadata ?? "");
    setAdminRoleName(initial.adminRoleName ?? "");
    setApproverRoleName(initial.approverRoleName ?? "");
    setRequestorRoleName(initial.requestorRoleName ?? "");
  }, [initial]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      apiClient.settings.adminUpdate({
        daoAccountId: daoAccountId.trim(),
        nearnAccountId: nearnAccountId.trim() || null,
        name: name.trim(),
        headline: headline.trim() || null,
        tagline: tagline.trim() || null,
        contactEmail: contactEmail.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        docsUrl: docsUrl.trim() || null,
        description: description.trim() || null,
        metadata: metadata.trim() || null,
        adminRoleName: adminRoleName.trim() || null,
        approverRoleName: approverRoleName.trim() || null,
        requestorRoleName: requestorRoleName.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "adminGet"] });
      await queryClient.invalidateQueries({ queryKey: ["settings", "public"] });
      toast.success("Agency configuration saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  const isPending = updateMutation.isPending;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Agency configuration</h2>
        <p className="text-sm text-muted-foreground">
          DAO membership and agency-level metadata. Changes apply immediately.
        </p>
      </div>
      <Card>
        <CardContent className="p-6 grid gap-4">
          <Field label="agency name" htmlFor="settings-name">
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </Field>
          <Field label="trezu sputnik dao account" htmlFor="settings-dao">
            <Input
              id="settings-dao"
              value={daoAccountId}
              onChange={(e) => setDaoAccountId(e.target.value)}
              placeholder="<your-dao>.sputnik-dao.near"
              disabled={isPending}
            />
          </Field>
          <Field label="nearn sponsor slug" htmlFor="settings-nearn">
            <Input
              id="settings-nearn"
              value={nearnAccountId}
              onChange={(e) => setNearnAccountId(e.target.value)}
              placeholder="your-sponsor-slug"
              disabled={isPending}
            />
          </Field>
          <Field label="website url" htmlFor="settings-website">
            <Input
              id="settings-website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={isPending}
            />
          </Field>
          <Field label="docs url" htmlFor="settings-docs">
            <Input
              id="settings-docs"
              type="url"
              value={docsUrl}
              onChange={(e) => setDocsUrl(e.target.value)}
              placeholder="https://docs.example.com"
              disabled={isPending}
            />
          </Field>
          <Field label="contact email" htmlFor="settings-contact-email">
            <Input
              id="settings-contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="hello@example.com"
              disabled={isPending}
            />
          </Field>
          <Field label="landing headline" htmlFor="settings-headline">
            <Input
              id="settings-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="An on-chain agency"
              disabled={isPending}
            />
          </Field>
          <Field label="landing tagline" htmlFor="settings-tagline">
            <textarea
              id="settings-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              rows={2}
              disabled={isPending}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
          <Field label="description" htmlFor="settings-description">
            <textarea
              id="settings-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={isPending}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
          <Field label="metadata (free-form text or JSON)" htmlFor="settings-metadata">
            <textarea
              id="settings-metadata"
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              rows={4}
              disabled={isPending}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Sputnik DAO role names
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Defaults match Trezu-managed DAOs (Admin / Approver / Requestor). Only override if
              your DAO uses different role names.
            </p>
          </div>
          <Field label="admin role name" htmlFor="settings-admin-role">
            <Input
              id="settings-admin-role"
              value={adminRoleName}
              onChange={(e) => setAdminRoleName(e.target.value)}
              placeholder="Admin"
              disabled={isPending}
            />
          </Field>
          <Field label="approver role name" htmlFor="settings-approver-role">
            <Input
              id="settings-approver-role"
              value={approverRoleName}
              onChange={(e) => setApproverRoleName(e.target.value)}
              placeholder="Approver"
              disabled={isPending}
            />
          </Field>
          <Field label="requestor role name" htmlFor="settings-requestor-role">
            <Input
              id="settings-requestor-role"
              value={requestorRoleName}
              onChange={(e) => setRequestorRoleName(e.target.value)}
              placeholder="Requestor"
              disabled={isPending}
            />
          </Field>
          <div>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={isPending || !daoAccountId.trim() || !name.trim()}
              size="sm"
            >
              {isPending ? "saving..." : "save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
