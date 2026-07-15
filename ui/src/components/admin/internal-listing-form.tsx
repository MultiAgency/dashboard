import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
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
  CardContent,
  Input,
} from "@/components";
import { Empty, Field, Loading, selectClass, textareaClass } from "@/components/admin-form";
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
  adminInternalListingQueryKey,
  adminInternalListingQueryOptions,
  adminProjectBudgetQueryKey,
  adminTokensQueryOptions,
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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Internal listing</h2>
        {!editing && row && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)} variant="outline" size="sm">
              edit
            </Button>
            <Button onClick={() => setConfirmDelete(true)} variant="ghost" size="sm">
              delete
            </Button>
          </div>
        )}
        {!editing && !row && !listingQuery.isLoading && (
          <Button onClick={() => setEditing(true)} variant="default" size="sm">
            + internal listing
          </Button>
        )}
      </div>

      {hasNearnListing && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>NEARN listing takes priority for rollups</AlertTitle>
          <AlertDescription>
            This project has a NEARN listing attached. The internal listing is dormant — rollup math
            uses NEARN. To activate the internal listing, detach NEARN from the project's edit form.
          </AlertDescription>
        </Alert>
      )}

      {listingQuery.isLoading ? (
        <Loading label="Loading internal listing..." />
      ) : editing ? (
        <InternalListingForm
          projectId={projectId}
          existing={row}
          onDone={() => setEditing(false)}
        />
      ) : row ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{row.type ?? "—"}</Badge>
              <Badge variant={row.isPublished && !row.isArchived ? "default" : "outline"}>
                {lifecycleLabel(row)}
              </Badge>
            </div>
            <div className="text-sm font-medium">{row.title ?? "(untitled)"}</div>
            <div className="font-mono text-sm">
              {row.rewardAmount ?? "0"} {row.token ?? ""}
            </div>
            {row.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.description}</p>
            )}
            {row.deadline && (
              <div className="text-xs text-muted-foreground">
                deadline: {new Date(row.deadline).toISOString().slice(0, 10)}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Empty label="No internal listing. Use this when no NEARN listing exists — notably on testnet, where NEARN is unavailable." />
      )}

      {row && (
        <InternalListingDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          projectId={projectId}
          listingTitle={row.title ?? "(untitled)"}
        />
      )}
    </section>
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminInternalListingQueryKey }),
      queryClient.invalidateQueries({ queryKey: adminProjectBudgetQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
    ]);
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
    <Card>
      <CardContent className="p-4 grid gap-3">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await form.validateAllFields("submit");
            if (form.state.canSubmit) form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => {
              const err = field.state.meta.errors[0];
              return (
                <Field label="title" htmlFor={field.name}>
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
                  {err && <p className="text-xs text-destructive">{fieldErr(err)}</p>}
                </Field>
              );
            }}
          </form.Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <form.Field name="type">
              {(field) => (
                <Field label="type" htmlFor={field.name}>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      const parsed = internalListingFormSchema.shape.type.safeParse(e.target.value);
                      if (parsed.success) field.handleChange(parsed.data);
                    }}
                    disabled={isPending}
                    className={selectClass}
                  >
                    <option value="Bounty">Bounty</option>
                    <option value="Project">Project</option>
                    <option value="Sponsorship">Sponsorship</option>
                  </select>
                </Field>
              )}
            </form.Field>

            <form.Field name="token">
              {(field) => (
                <Field label="token" htmlFor={field.name}>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={isPending || tokensQuery.isLoading}
                    className={selectClass}
                  >
                    {tokens.length === 0 && <option value="NEAR">NEAR</option>}
                    {tokens.map((t) => (
                      <option key={t.tokenId} value={t.symbol}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </form.Field>

            <form.Field name="rewardAmount">
              {(field) => {
                const err = field.state.meta.errors[0];
                return (
                  <Field label="reward amount" htmlFor={field.name}>
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
                    {err && <p className="text-xs text-destructive">{fieldErr(err)}</p>}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <form.Field name="description">
            {(field) => (
              <Field label="description (optional)" htmlFor={field.name}>
                <textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                  disabled={isPending}
                  className={textareaClass}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="deadline">
            {(field) => (
              <Field label="deadline (optional, YYYY-MM-DD)" htmlFor={field.name}>
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
                <Field label="status" htmlFor={field.name}>
                  <select
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      const next = e.target.value as InternalListingLifecycle;
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
                    className={selectClass}
                  >
                    {internalListingLifecycleValues.map((v) => (
                      <option key={v} value={v} disabled={isEdit && !allowed.has(v)}>
                        {formatLifecycle(v)}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            }}
          </form.Field>

          <p className="text-xs text-muted-foreground">
            Lifecycle drives the rollup column the listing contributes to: <code>published</code> +
            no winners → <em>allocated</em>; <code>winners announced</code> → <em>committed</em>{" "}
            (until a billing exists); <code>archived</code> or unpublished → excluded.
          </p>

          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} size="sm">
              {isPending ? "saving..." : isEdit ? "save changes" : "create listing"}
            </Button>
            <Button onClick={onDone} variant="outline" disabled={isPending} size="sm" type="button">
              cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminInternalListingQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminProjectBudgetQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["treasury", "rollups"] }),
      ]);
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
      confirmLabel="delete listing"
      destructive
      onConfirm={async () => {
        await deleteMutation.mutateAsync();
      }}
    />
  );
}
