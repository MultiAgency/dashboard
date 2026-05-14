import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Input,
  Textarea,
} from "@/components";
import { Field } from "@/components/admin-form";
import { SetupYourAgency } from "@/components/setup-agency";
import { useMeRoles } from "@/hooks/use-me-roles";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/_authenticated/settings")({
  head: () => ({
    meta: [{ title: "Settings" }, { name: "description", content: "Agency configuration." }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const apiClient = useApiClient();
  const { isAdmin } = useMeRoles();

  const publicSettingsQuery = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => apiClient.settings.getPublic(),
    staleTime: 5 * 60_000,
  });

  const adminSettingsQuery = useQuery({
    queryKey: ["settings", "adminGet"],
    queryFn: () => apiClient.settings.adminGet(),
    retry: false,
  });

  const isPlaceholder = !!publicSettingsQuery.data?.isPlaceholder;

  if (isPlaceholder) {
    return (
      <div className="space-y-8 animate-fade-in">
        <header className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            agency · bootstrap
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
            Settings
          </h1>
        </header>
        <SetupYourAgency />
      </div>
    );
  }

  if (!isAdmin || !adminSettingsQuery.data) {
    return (
      <div className="space-y-8 animate-fade-in">
        <header className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            agency · config
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
            Settings
          </h1>
        </header>
        <Empty className="border-2 border-dashed border-border/40">
          <EmptyTitle className="font-display text-2xl uppercase tracking-tight text-muted-foreground">
            admin only
          </EmptyTitle>
          <EmptyDescription className="font-mono text-xs uppercase tracking-wide">
            agency configuration requires an admin role on the dao.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          agency · config
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-black uppercase leading-none tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Agency identity, DAO configuration, and outbound integrations. Changes apply immediately.
        </p>
      </header>
      <AgencyConfigSections initial={adminSettingsQuery.data.settings} />
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
  adminRoleName: string | null;
  approverRoleName: string | null;
  requestorRoleName: string | null;
};

function AgencyConfigSections({ initial }: { initial: Settings }) {
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
  const canSubmit = !isPending && !!daoAccountId.trim() && !!name.trim();

  return (
    <div className="space-y-8">
      <section id="identity" className="space-y-3 scroll-mt-20">
        <SectionHeader eyebrow="identity" title="Agency Identity" />
        <Card>
          <CardContent className="p-6 pt-6 grid gap-4">
            <Field
              label="agency name"
              htmlFor="settings-name"
              helper="Renders as the brand wordmark on the landing and the header aria-label. (Browser tab + share titles come from the runtime gateway, not this field.)"
            >
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
              />
            </Field>
            <Field
              label="landing headline"
              htmlFor="settings-headline"
              helper="Big poster line shown directly under the agency wordmark on the landing."
            >
              <Input
                id="settings-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Open Books · Open Source · Open Doors"
                disabled={isPending}
              />
            </Field>
            <Field
              label="landing tagline"
              htmlFor="settings-tagline"
              helper="Short descriptor used as the browser tab / share title. Not displayed on the landing itself."
            >
              <Input
                id="settings-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="The future of work is near…"
                disabled={isPending}
              />
            </Field>
            <Field
              label="description"
              htmlFor="settings-description"
              helper="Long-form description. Renders as a paragraph below the tagline on the landing when set."
            >
              <Textarea
                id="settings-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={isPending}
              />
            </Field>
            <Field
              label="website url"
              htmlFor="settings-website"
              helper="Optional. Stored for forks to surface elsewhere; not currently rendered in v1."
            >
              <Input
                id="settings-website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                disabled={isPending}
              />
            </Field>
            <Field
              label="docs url"
              htmlFor="settings-docs"
              helper="Optional external documentation site. When set, renders as an additional `docs site →` link in the landing footer alongside the always-visible internal `docs →` link to /docs."
            >
              <Input
                id="settings-docs"
                type="url"
                value={docsUrl}
                onChange={(e) => setDocsUrl(e.target.value)}
                placeholder="https://docs.example.com"
                disabled={isPending}
              />
            </Field>
          </CardContent>
        </Card>
      </section>

      <section id="dao" className="space-y-3 scroll-mt-20">
        <SectionHeader eyebrow="on chain" title="DAO Configuration" />
        <Card>
          <CardContent className="p-6 pt-6 grid gap-4">
            <Field
              label="trezu sputnik dao account"
              htmlFor="settings-dao"
              helper="The Sputnik DAO contract this dashboard observes. Required for all treasury, proposal, and team data."
            >
              <Input
                id="settings-dao"
                value={daoAccountId}
                onChange={(e) => setDaoAccountId(e.target.value)}
                placeholder="<your-dao>.sputnik-dao.near"
                disabled={isPending}
              />
            </Field>
            <Field
              label="admin role name"
              htmlFor="settings-admin-role"
              helper="On-chain role name for governance actions. Defaults to `Admin` (Trezu convention). Override only if your DAO uses different role names."
            >
              <Input
                id="settings-admin-role"
                value={adminRoleName}
                onChange={(e) => setAdminRoleName(e.target.value)}
                placeholder="Admin"
                disabled={isPending}
              />
            </Field>
            <Field
              label="approver role name"
              htmlFor="settings-approver-role"
              helper="On-chain role name for financial approvals (treasury reads, allocation writes). Defaults to `Approver`."
            >
              <Input
                id="settings-approver-role"
                value={approverRoleName}
                onChange={(e) => setApproverRoleName(e.target.value)}
                placeholder="Approver"
                disabled={isPending}
              />
            </Field>
            <Field
              label="requestor role name"
              htmlFor="settings-requestor-role"
              helper="On-chain role name for filing payment requests. Defaults to `Requestor`."
            >
              <Input
                id="settings-requestor-role"
                value={requestorRoleName}
                onChange={(e) => setRequestorRoleName(e.target.value)}
                placeholder="Requestor"
                disabled={isPending}
              />
            </Field>
          </CardContent>
        </Card>
      </section>

      <section id="nearn" className="space-y-3 scroll-mt-20">
        <SectionHeader eyebrow="bounties" title="NEARN Sponsor" />
        <Card>
          <CardContent className="p-6 pt-6 grid gap-4">
            <Field
              label="nearn sponsor slug"
              htmlFor="settings-nearn"
              helper="Your NEARN handle (e.g. `multiagency`). Used to link visitors to your bounty listings from /work, /apply, and the landing."
            >
              <Input
                id="settings-nearn"
                value={nearnAccountId}
                onChange={(e) => setNearnAccountId(e.target.value)}
                placeholder="your-sponsor-slug"
                disabled={isPending}
              />
            </Field>
          </CardContent>
        </Card>
      </section>

      <section id="contact" className="space-y-3 scroll-mt-20">
        <SectionHeader eyebrow="reach" title="Contact" />
        <Card>
          <CardContent className="p-6 pt-6 grid gap-4">
            <Field
              label="contact email"
              htmlFor="settings-contact-email"
              helper="Public inbox shown on /contact. If empty, /contact shows an `apply →` CTA pointing visitors to the apply form."
            >
              <Input
                id="settings-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="hello@example.com"
                disabled={isPending}
              />
            </Field>
          </CardContent>
        </Card>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <Button
          onClick={() => updateMutation.mutate()}
          disabled={!canSubmit}
          className="font-display uppercase tracking-wide"
        >
          {isPending ? "saving..." : "save →"}
        </Button>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        {eyebrow}
      </div>
      <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight font-extrabold leading-[0.95]">
        {title}
      </h2>
    </div>
  );
}
