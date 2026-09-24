import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { useAuthClient } from "@/app";
import { Button, Card, CardContent, Input, Spinner, Textarea } from "@/components";
import { TreasurySettings } from "@/components/admin/treasury-settings";
import { AdminError } from "@/components/admin-error";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import {
  adminSettingsQueryOptions,
  myOrganizationsQueryOptions,
  refreshAfter,
} from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/admin/settings")({
  head: () => ({
    meta: [{ title: "Settings | Admin" }],
  }),
  validateSearch: z.object({
    tab: z.enum(["members"]).optional(),
  }),
  beforeLoad: ({ search }) => {
    if (search.tab === "members") {
      throw redirect({ to: "/admin/members" });
    }
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminSettingsQueryOptions(context.apiClient)),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · settings
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Settings
        </h1>
      </header>
      <OrganizationIdentity />
      <section id="treasury" className="space-y-3 scroll-mt-24">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          treasury
        </div>
        <TreasurySettings />
      </section>
      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          organization
        </div>
        <AdminSettings />
      </section>
    </div>
  );
}

function OrganizationIdentity() {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const organizations = useQuery(myOrganizationsQueryOptions(apiClient)).data?.data ?? [];
  const active = organizations.find((o) => o.id === session?.session?.activeOrganizationId);
  if (!active) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-1">
        <div className="font-display text-xl uppercase font-extrabold">{active.name}</div>
        <p className="text-sm text-muted-foreground">
          Slug <span className="font-mono text-foreground">{active.slug}</span>. An Agency needs
          this slug and the exact name to propose an Engagement to your Organization.
        </p>
      </CardContent>
    </Card>
  );
}

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https?:\/\//.test(s), "must start with http:// or https://");

const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .refine((s) => s === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "not a valid email");

const settingsFormSchema = z.object({
  nearnAccountId: z.string().trim().max(120),
  websiteUrl: optionalUrl,
  docsUrl: optionalUrl,
  description: z.string().trim().max(500),
  contactEmail: optionalEmail,
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";
const ERROR_CLS = "text-sm text-destructive";

function fieldErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "invalid";
  }
  return "invalid";
}

function AdminSettings() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(adminSettingsQueryOptions(apiClient));

  if (settingsQuery.isLoading) {
    return (
      <section className="space-y-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          loading…
        </p>
      </section>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return <AdminError error={settingsQuery.error} />;
  }

  return <SettingsForm data={settingsQuery.data} apiClient={apiClient} queryClient={queryClient} />;
}

function SettingsForm({
  data,
  apiClient,
  queryClient,
}: {
  data: NonNullable<Awaited<ReturnType<typeof apiClient.agencyConfig.get>>>;
  apiClient: ReturnType<typeof useApiClient>;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const submit = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      apiClient.agencyConfig.update({
        nearnAccountId: values.nearnAccountId.trim() || null,
        websiteUrl: values.websiteUrl.trim() || null,
        docsUrl: values.docsUrl.trim() || null,
        description: values.description.trim() || null,
        contactEmail: values.contactEmail.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Settings updated");
      void refreshAfter(queryClient, { type: "settings" });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update settings"),
  });

  const form = useForm({
    defaultValues: {
      nearnAccountId: data.editable.nearnAccountId ?? "",
      websiteUrl: data.editable.websiteUrl ?? "",
      docsUrl: data.editable.docsUrl ?? "",
      description: data.editable.description ?? "",
      contactEmail: data.editable.contactEmail ?? "",
    } as SettingsFormValues,
    validators: { onChange: settingsFormSchema, onSubmit: settingsFormSchema },
    onSubmit: async ({ value }) => {
      await submit.mutateAsync(value);
    },
  });

  const isPending = submit.isPending;

  return (
    <section className="space-y-8">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Agency-level configuration for the {data.network} deployment. Editable fields write to the
        settings row for this workspace. Read-only fields are deploy-time config — env vars or
        hardcoded brand identity.
      </p>

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              editable
            </div>
            <p className="text-sm text-muted-foreground">
              NEARN account link and basic metadata. Saved to this workspace's settings row.
            </p>
          </div>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await form.validateAllFields("submit");
              if (form.state.canSubmit) {
                form.handleSubmit();
              }
            }}
          >
            <form.Field name="nearnAccountId">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      nearn account id
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="multiagency"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="contactEmail">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      contact email
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="hello@example.com"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="websiteUrl">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      website url
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="url"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://multiagency.ai"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="docsUrl">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      docs url
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="url"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://docs.multiagency.ai"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="description">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      description
                    </label>
                    <Textarea
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      rows={4}
                      placeholder="One or two sentences for the landing hero pitch."
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className="w-full font-display uppercase tracking-wide"
            >
              {isPending && <Spinner />}
              {isPending ? "saving…" : "save →"}
            </Button>
          </form>
          {data.audit && (
            <div className="space-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <p>
                created by {data.audit.createdBy} on {data.audit.createdAt.slice(0, 10)}
              </p>
              <p>
                last updated by {data.audit.updatedBy} on {data.audit.updatedAt.slice(0, 10)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
