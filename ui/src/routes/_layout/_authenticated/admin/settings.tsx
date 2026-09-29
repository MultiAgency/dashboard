import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
import { PageHeader } from "@/components/page-header";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Your Organization's identity, treasury and public Agency details."
      />
      <OrganizationIdentity />
      <section id="treasury" className="scroll-mt-24">
        <TreasurySettings />
      </section>
      <AdminSettings />
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
      <CardHeader>
        <CardTitle>
          <h2>Organization</h2>
        </CardTitle>
        <CardDescription>
          An Agency needs this slug and the exact name to propose an Engagement to your
          Organization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="font-medium break-words">{active.name}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Slug</dt>
            <dd className="font-medium break-all">{active.slug}</dd>
          </div>
        </dl>
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
        <CardDescription>
          Public details for the {data.network} deployment, saved to this workspace's settings.
        </CardDescription>
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
