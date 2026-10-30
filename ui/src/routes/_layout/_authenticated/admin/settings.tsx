import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuthClient } from "@/app";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
  Textarea,
} from "@/components";
import { TreasurySettings } from "@/components/admin/treasury-settings";
import { AdminError } from "@/components/admin-error";
import { Loading } from "@/components/admin-form";
import { AgencyNamePrompt, useActiveOrganization } from "@/components/agency-name-prompt";
import { PageHeader } from "@/components/page-header";
import { SettingsSection } from "@/components/settings-section";
import { WorkOrderIntegrationSettings } from "@/components/work-orders/integration-settings";
import { PayoutAgentSettings } from "@/components/work-orders/payout-agent-settings";
import { WorkOrderRepresentativeSettings } from "@/components/work-orders/representative-settings";
import { SetupChecklist } from "@/components/work-orders/setup-checklist";
import { WorkOrderTrustSettings } from "@/components/work-orders/trust-settings";
import { useMeRoles } from "@/hooks/use-me-roles";
import { refreshAccountQueries } from "@/lib/account";
import { useApiClient } from "@/lib/api";
import { adminSettingsQueryOptions, refreshAfter } from "@/lib/queries";

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
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      <SetupChecklist compact />
      <SettingsSection
        id="organization"
        title="Organization"
        description="Name and slug Agencies use to reach you."
      >
        <OrganizationIdentity />
      </SettingsSection>
      <SettingsSection
        id="treasury"
        title="Treasury"
        description="The DAO that funds your Projects."
      >
        <TreasurySettings />
      </SettingsSection>
      <SettingsSection
        id="work-orders"
        title="Work orders: documents and email"
        description="Representative, template, Drive and emails."
      >
        <div className="flex flex-col gap-4">
          <WorkOrderRepresentativeSettings />
          <WorkOrderIntegrationSettings />
        </div>
      </SettingsSection>
      <SettingsSection
        id="work-order-approval"
        title="Automatic approval"
        description="When requests skip your approval."
      >
        <WorkOrderTrustSettings />
      </SettingsSection>
      <SettingsSection
        id="payouts"
        title="Automatic payouts (NEAR Intents)"
        description="Rules, monthly budget, balance and top-ups."
      >
        <PayoutAgentSettings />
      </SettingsSection>
      <SettingsSection id="agency" title="Agency details" description="Your public profile.">
        <AdminSettings />
      </SettingsSection>
    </div>
  );
}

function OrganizationIdentity() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { canAccessAdmin: canManage } = useMeRoles();
  const active = useActiveOrganization();
  const [name, setName] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: async (next: string) => {
      if (!active) throw new Error("No active Organization");
      const { error } = await authClient.organization.update({
        organizationId: active.id,
        data: { name: next },
      });
      if (error) throw new Error(error.message ?? "Could not rename the Organization");
    },
    onSuccess: async () => {
      setName(null);
      await refreshAccountQueries(queryClient);
      toast.success("Organization renamed");
    },
    onError: (err: Error) => toast.error(err.message || "Could not rename the Organization"),
  });
  if (!active) return null;
  const draft = name ?? active.name;
  const trimmed = draft.trim();
  return (
    <div className="flex flex-col gap-4">
      <AgencyNamePrompt linkToSettings={false} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Organization</h2>
          </CardTitle>
          <CardDescription>Builders see this name in every work order email.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage ? (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (trimmed && trimmed !== active.name) rename.mutate(trimmed);
              }}
            >
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor="organization-name">Name</FieldLabel>
                <Input
                  id="organization-name"
                  value={draft}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  disabled={rename.isPending}
                />
              </Field>
              <Button
                type="submit"
                size="sm"
                disabled={rename.isPending || !trimmed || trimmed === active.name}
              >
                {rename.isPending ? "Renaming…" : "Rename"}
              </Button>
            </form>
          ) : null}
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {canManage ? null : (
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="font-medium break-words">{active.name}</dd>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Slug</dt>
              <dd className="font-medium break-all">{active.slug}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
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
    return <Loading label="Loading settings" />;
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return <AdminError error={settingsQuery.error} />;
  }

  return <SettingsForm data={settingsQuery.data} apiClient={apiClient} queryClient={queryClient} />;
}

function FormField({
  name,
  label,
  description,
  error,
  children,
}: {
  name: string;
  label: string;
  description?: ReactNode;
  error: unknown;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      {error ? (
        <FieldError id={`${name}-error`} aria-live="polite">
          {fieldErrorMessage(error)}
        </FieldError>
      ) : null}
    </Field>
  );
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
    onError: (err: Error) => toast.error(err.message || "Couldn't save"),
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
  const inputProps = (field: {
    name: string;
    state: { value: string; meta: { errors: unknown[] } };
    handleBlur: () => void;
    handleChange: (value: string) => void;
  }) => {
    const err = field.state.meta.errors[0];
    return {
      id: field.name,
      name: field.name,
      value: field.state.value,
      onBlur: field.handleBlur,
      disabled: isPending,
      "aria-invalid": err ? true : undefined,
      "aria-describedby": err ? `${field.name}-error` : undefined,
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Agency details</h2>
        </CardTitle>
        <CardDescription>Public details for {data.network}.</CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await form.validateAllFields("submit");
          if (form.state.canSubmit) {
            form.handleSubmit();
          }
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <form.Field name="nearnAccountId">
                {(field) => (
                  <FormField
                    name={field.name}
                    label="NEARN account ID"
                    description="Links your NEARN sponsor bounties to Projects."
                    error={field.state.meta.errors[0]}
                  >
                    <Input
                      {...inputProps(field)}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="multiagency"
                    />
                  </FormField>
                )}
              </form.Field>
              <form.Field name="contactEmail">
                {(field) => (
                  <FormField
                    name={field.name}
                    label="Contact email"
                    error={field.state.meta.errors[0]}
                  >
                    <Input
                      {...inputProps(field)}
                      type="email"
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="hello@example.com"
                    />
                  </FormField>
                )}
              </form.Field>
              <form.Field name="websiteUrl">
                {(field) => (
                  <FormField
                    name={field.name}
                    label="Website URL"
                    error={field.state.meta.errors[0]}
                  >
                    <Input
                      {...inputProps(field)}
                      type="url"
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://multiagency.ai"
                    />
                  </FormField>
                )}
              </form.Field>
              <form.Field name="docsUrl">
                {(field) => (
                  <FormField name={field.name} label="Docs URL" error={field.state.meta.errors[0]}>
                    <Input
                      {...inputProps(field)}
                      type="url"
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="https://docs.multiagency.ai"
                    />
                  </FormField>
                )}
              </form.Field>
            </div>
            <form.Field name="description">
              {(field) => (
                <FormField
                  name={field.name}
                  label="Description"
                  description="One or two sentences for the landing page."
                  error={field.state.meta.errors[0]}
                >
                  <Textarea
                    {...inputProps(field)}
                    onChange={(e) => field.handleChange(e.target.value)}
                    rows={4}
                    placeholder="What your Agency does, in a sentence or two."
                  />
                </FormField>
              )}
            </form.Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          {data.audit ? (
            <p className="text-xs text-muted-foreground">
              Last updated by {data.audit.updatedBy} on {data.audit.updatedAt.slice(0, 10)}
            </p>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={isPending}>
            {isPending && <Spinner data-icon="inline-start" />}
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
