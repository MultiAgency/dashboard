import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { Button, Card, CardContent, Input, Spinner, Textarea } from "@/components";
import { AdminError } from "@/components/admin-error";
import { useApiClient } from "@/lib/api";
import {
  adminSettingsQueryKey,
  adminSettingsQueryOptions,
  publicSettingsQueryKey,
} from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/_admin/admin/settings/")({
  head: () => ({
    meta: [{ title: "Settings | Admin" }],
  }),
  component: AdminSettings,
});

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
  daoAccountId: z.string().trim().max(120),
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
        daoAccountId: values.daoAccountId.trim() || null,
        nearnAccountId: values.nearnAccountId.trim() || null,
        websiteUrl: values.websiteUrl.trim() || null,
        docsUrl: values.docsUrl.trim() || null,
        description: values.description.trim() || null,
        contactEmail: values.contactEmail.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Settings updated");
      queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey });
      queryClient.invalidateQueries({ queryKey: publicSettingsQueryKey });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update settings"),
  });

  const form = useForm({
    defaultValues: {
      daoAccountId: data.editable.daoAccountId ?? "",
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
      <div className="space-y-2">
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Agency-level configuration for the {data.network} deployment. Editable fields write to the{" "}
          settings row for this organization. Read-only fields are deploy-time config — env vars or
          hardcoded brand identity.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              editable
            </div>
            <p className="text-sm text-muted-foreground">
              NEARN account link and basic metadata. Saved to this organization's settings row.
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
            <div className="space-y-2">
              <div className={LABEL_CLS}>agency account</div>
              <div className="font-mono text-sm break-all px-3 py-2 border border-border bg-muted/30">
                {data.orgAccountId}
              </div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                row identity — resolved from org metadata, settings table, or{" "}
                <code>AGENCY_ORG_ACCOUNT_{data.network.toUpperCase()}</code> fallback.
              </p>
            </div>
            <form.Field name="daoAccountId">
              {(field) => {
                const err = field.state.meta.errors[0];
                const errId = `${field.name}-error`;
                return (
                  <div className="space-y-2">
                    <label htmlFor={field.name} className={LABEL_CLS}>
                      sputnik dao account
                    </label>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="multiagency.sputnik-dao.near"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                    />
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Links this organization to a Sputnik DAO for treasury/proposals display. Not
                      used for access control.
                    </p>
                    {err && (
                      <p id={errId} aria-live="polite" className={ERROR_CLS}>
                        {fieldErrorMessage(err)}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
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

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              deploy-time config
            </div>
            <p className="text-sm text-muted-foreground">
              Configured via env vars or hardcoded in source. Not editable here.
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <ReadOnly label="agency name" value={data.readOnly.name} />
            <ReadOnly label="headline" value={data.readOnly.headline} />
            <ReadOnly label="tagline" value={data.readOnly.tagline} />
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1">
      <dt className={LABEL_CLS}>{label}</dt>
      <dd className="font-mono text-sm break-all">{value ?? "—"}</dd>
    </div>
  );
}
