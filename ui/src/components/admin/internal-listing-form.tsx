import {
  MegaphoneIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FieldError,
  FieldGroup,
  Input,
  Skeleton,
  Textarea,
} from "@/components";
import { ChoiceSelect, Empty, Field } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { type ApiClient, useApiClient } from "@/lib/api";
import {
  flagsToLifecycle,
  lifecycleLabel as formatLifecycle,
  type InternalListingLifecycle,
  internalListingLifecycleValues,
  LIFECYCLE_TRANSITIONS,
} from "@/lib/listing-lifecycle";
import {
  adminInternalListingQueryOptions,
  adminTokensQueryOptions,
  refreshAfter,
} from "@/lib/queries";

type InternalListing = NonNullable<
  Awaited<ReturnType<ApiClient["agency"]["listings"]["get"]>>["listing"]
>;

const internalListingFormSchema = z.object({
  title: z.string().trim().min(1, "required").max(200),
  type: z.enum(["Bounty", "Project", "Sponsorship"]),
  token: z.string().trim().min(1, "required"),
  rewardAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'decimal amount e.g. "100" or "100.5"')
    .max(80)
    .refine((s) => Number.parseFloat(s) > 0, "must be greater than 0"),
  description: z.string().trim().max(16000),
  deadline: z.string().trim(),
  lifecycle: z.enum(["draft", "published", "winners_announced", "archived"]),
});

type InternalListingFormValues = z.infer<typeof internalListingFormSchema>;

function lifecycleLabel(row: InternalListing): string {
  return formatLifecycle(flagsToLifecycle(row));
}

function fieldErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "invalid";
  }
  return "invalid";
}

export function InternalListingSection({
  projectId,
  hasNearnListing,
}: {
  projectId: string;
  hasNearnListing: boolean;
}) {
  const apiClient = useApiClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const listingQuery = useQuery(adminInternalListingQueryOptions(apiClient, projectId));

  const row = listingQuery.data?.listing ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Internal listing</h2>
        </CardTitle>
        <CardDescription>
          A bounty kept on this platform, for when no NEARN listing exists (notably on testnet).
        </CardDescription>
        {!editing && !listingQuery.isLoading && (
          <CardAction>
            {row ? (
              <div className="flex gap-1">
                <Button
                  onClick={() => setEditing(true)}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit internal listing"
                >
                  <PencilSimpleIcon aria-hidden />
                </Button>
                <Button
                  onClick={() => setConfirmDelete(true)}
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete internal listing"
                >
                  <TrashIcon aria-hidden />
                </Button>
              </div>
            ) : (
              <Button onClick={() => setEditing(true)} size="sm">
                <PlusIcon data-icon="inline-start" aria-hidden />
                New listing
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>

      {hasNearnListing && (
        <CardContent>
          <Alert>
            <WarningIcon aria-hidden />
            <AlertTitle>NEARN listing takes priority for rollups</AlertTitle>
            <AlertDescription>
              This project has a NEARN listing attached, so the internal listing is dormant. Detach
              NEARN in the project details to activate it.
            </AlertDescription>
          </Alert>
        </CardContent>
      )}

      {listingQuery.isLoading ? (
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      ) : editing ? (
        <InternalListingForm
          projectId={projectId}
          existing={row}
          onDone={() => setEditing(false)}
        />
      ) : row ? (
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{row.type ?? "—"}</Badge>
            <Badge variant={row.isPublished && !row.isArchived ? "default" : "outline"}>
              {lifecycleLabel(row)}
            </Badge>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Title</dt>
              <dd className="font-medium break-words">{row.title ?? "(untitled)"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Reward</dt>
              <dd className="font-medium tabular-nums">
                {row.rewardAmount ?? "0"} {row.token ?? ""}
              </dd>
            </div>
            {row.deadline && (
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Deadline</dt>
                <dd className="tabular-nums">
                  {new Date(row.deadline).toISOString().slice(0, 10)}
                </dd>
              </div>
            )}
          </dl>
          {row.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.description}</p>
          )}
        </CardContent>
      ) : (
        <CardContent>
          <Empty icon={<MegaphoneIcon aria-hidden />} label="No internal listing" />
        </CardContent>
      )}

      {row && (
        <InternalListingDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          projectId={projectId}
          listingTitle={row.title ?? "(untitled)"}
        />
      )}
    </Card>
  );
}

function InternalListingForm({
  projectId,
  existing,
  onDone,
}: {
  projectId: string;
  existing: InternalListing | null;
  onDone: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const tokensQuery = useQuery(adminTokensQueryOptions(apiClient));
  const tokens = tokensQuery.data?.tokens ?? [];

  const isEdit = existing !== null;

  const invalidate = async () => {
    await refreshAfter(queryClient, { type: "listing", projectId });
  };

  const submitMutation = useMutation({
    mutationFn: async (values: InternalListingFormValues) => {
      const deadlineDate = values.deadline ? new Date(values.deadline) : null;
      const payload = {
        projectId,
        title: values.title.trim(),
        type: values.type,
        token: values.token,
        rewardAmount: values.rewardAmount.trim(),
        description: values.description.trim() || undefined,
        deadline: deadlineDate,
        lifecycle: values.lifecycle,
      };
      if (isEdit) {
        return apiClient.agency.listings.update(payload);
      }
      return apiClient.agency.listings.create(payload);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(isEdit ? "Internal listing updated" : "Internal listing created");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save internal listing"),
  });

  const form = useForm({
    defaultValues: {
      title: existing?.title ?? "",
      type: internalListingFormSchema.shape.type.safeParse(existing?.type).data ?? "Bounty",
      token: existing?.token ?? "NEAR",
      rewardAmount: existing?.rewardAmount ?? "",
      description: existing?.description ?? "",
      deadline: existing?.deadline ? new Date(existing.deadline).toISOString().slice(0, 10) : "",
      lifecycle: existing
        ? ((existing as { lifecycle?: InternalListingLifecycle }).lifecycle ??
          flagsToLifecycle(existing))
        : ("draft" as InternalListingLifecycle),
    } as InternalListingFormValues,
    validators: { onChange: internalListingFormSchema, onSubmit: internalListingFormSchema },
    onSubmit: async ({ value }) => {
      await submitMutation.mutateAsync(value);
    },
  });

  const isPending = submitMutation.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await form.validateAllFields("submit");
        if (form.state.canSubmit) form.handleSubmit();
      }}
    >
      <CardContent>
        <FieldGroup>
          <form.Field name="title">
            {(field) => {
              const err = field.state.meta.errors[0];
              return (
                <Field label="Title" htmlFor={field.name}>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g. Build the agency portal"
                    disabled={isPending}
                    aria-invalid={err ? true : undefined}
                  />
                  {err && <FieldError>{fieldErr(err)}</FieldError>}
                </Field>
              );
            }}
          </form.Field>

          <div className="grid gap-6 sm:grid-cols-3 sm:items-start">
            <form.Field name="type">
              {(field) => (
                <Field label="Type" htmlFor={field.name}>
                  <ChoiceSelect
                    id={field.name}
                    value={field.state.value}
                    onValueChange={(value) => {
                      const parsed = internalListingFormSchema.shape.type.safeParse(value);
                      if (parsed.success) field.handleChange(parsed.data);
                    }}
                    disabled={isPending}
                    options={[
                      { value: "Bounty", label: "Bounty" },
                      { value: "Project", label: "Project" },
                      { value: "Sponsorship", label: "Sponsorship" },
                    ]}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="token">
              {(field) => (
                <Field label="Token" htmlFor={field.name}>
                  <ChoiceSelect
                    id={field.name}
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value)}
                    disabled={isPending || tokensQuery.isLoading}
                    options={
                      tokens.length === 0
                        ? [{ value: "NEAR", label: "NEAR" }]
                        : tokens.map((t) => ({ value: t.symbol, label: t.symbol }))
                    }
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="rewardAmount">
              {(field) => {
                const err = field.state.meta.errors[0];
                return (
                  <Field label="Reward amount" htmlFor={field.name}>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="100"
                      inputMode="decimal"
                      disabled={isPending}
                      aria-invalid={err ? true : undefined}
                    />
                    {err && <FieldError>{fieldErr(err)}</FieldError>}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <form.Field name="description">
            {(field) => (
              <Field label="Description" htmlFor={field.name}>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                  placeholder="Optional"
                  disabled={isPending}
                />
              </Field>
            )}
          </form.Field>

          <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
            <form.Field name="deadline">
              {(field) => (
                <Field label="Deadline" htmlFor={field.name} helper="Optional.">
                  <Input
                    id={field.name}
                    name={field.name}
                    type="date"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={isPending}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="lifecycle">
              {(field) => {
                const current = field.state.value as InternalListingLifecycle;
                const allowed = new Set([current, ...(LIFECYCLE_TRANSITIONS[current] ?? [])]);
                return (
                  <Field
                    label="Status"
                    htmlFor={field.name}
                    helper="Published counts as allocated, winners announced as committed until billed; archived is excluded."
                  >
                    <ChoiceSelect
                      id={field.name}
                      value={field.state.value}
                      onValueChange={(value) => {
                        const next = value as InternalListingLifecycle;
                        if (isEdit && !allowed.has(next)) {
                          if (
                            !window.confirm(
                              `Move listing from ${formatLifecycle(current)} to ${formatLifecycle(next)}?`,
                            )
                          ) {
                            return;
                          }
                        }
                        field.handleChange(next);
                      }}
                      disabled={isPending}
                      options={internalListingLifecycleValues.map((v) => ({
                        value: v,
                        label: formatLifecycle(v),
                        disabled: isEdit && !allowed.has(v),
                      }))}
                    />
                  </Field>
                );
              }}
            </form.Field>
          </div>
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button onClick={onDone} variant="outline" disabled={isPending} type="button">
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Create listing"}
        </Button>
      </CardFooter>
    </form>
  );
}

function InternalListingDeleteDialog({
  open,
  onOpenChange,
  projectId,
  listingTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  listingTitle: string;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.agency.listings.delete({ projectId }),
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "listing", projectId });
      toast.success("Internal listing deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete internal listing"),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete internal listing "${listingTitle}"?`}
      description="The listing's contribution to allocated/committed rollup columns disappears immediately. This cannot be undone."
      confirmLabel="Delete listing"
      destructive
      onConfirm={async () => {
        await deleteMutation.mutateAsync();
      }}
    />
  );
}
