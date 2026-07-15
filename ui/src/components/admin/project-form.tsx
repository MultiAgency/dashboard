import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input } from "@/components";
import { Field, selectClass, textareaClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { nearnListingHref } from "@/lib/nearn";
import {
  adminProjectsListQueryKey,
  projectsListQueryKey,
  publicSettingsQueryOptions,
} from "@/lib/queries";
import { isValidSlug, slugify } from "@/lib/slugify";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type ProjectStatus = "active" | "paused" | "archived";
export type Visibility = "public" | "unlisted" | "private";

export type Project = {
  id?: string;
  slug: string;
  title: string;
  repository?: string | null;
  nearnListingId?: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  description?: string | null;
};

export type ProjectFormValues = Project;

export function ProjectForm({
  mode,
  defaultValues,
  publicNearnHref,
  onDone,
}: {
  mode: "create" | "edit";
  defaultValues?: Partial<ProjectFormValues>;
  publicNearnHref?: string | null;
  onDone?: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [slug, setSlug] = useState(defaultValues?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit" || !!defaultValues?.slug);
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [repository, setRepository] = useState(defaultValues?.repository ?? "");
  const [nearnListingId, setNearnListingId] = useState(defaultValues?.nearnListingId ?? "");
  const [status, setStatus] = useState<ProjectStatus>(defaultValues?.status ?? "active");
  const [vis, setVis] = useState<Visibility>(defaultValues?.visibility ?? "private");

  const nearnSlug = nearnListingId.trim();
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const nearnListingQuery = useQuery({
    queryKey: ["admin", "nearn", "listing", nearnSlug],
    queryFn: () => apiClient.nearn.getListing({ slug: nearnSlug }),
    enabled: nearnSlug.length > 1,
    retry: false,
    staleTime: 60_000,
  });

  const resolvedNearnHref =
    publicNearnHref ||
    nearnListingHref(
      nearnListingQuery.data?.listing ?? {},
      settingsQuery.data?.nearnAccountId ?? null,
    );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  };

  const repositoryTrimmed = repository.trim();
  const repositoryOk = isHttpUrl(repositoryTrimmed);
  const slugTrimmed = slug.trim();

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return apiClient.agency.projects.create({
          slug: slugTrimmed,
          title: title.trim(),
          description: description.trim() || undefined,
          repository: repositoryTrimmed,
          nearnListingId: nearnSlug || undefined,
          status,
          visibility: vis,
        });
      }
      if (!defaultValues?.id) throw new Error("Missing project id");
      return apiClient.agency.projects.update({
        id: defaultValues.id,
        title: title.trim(),
        description: description.trim() || null,
        repository: repositoryTrimmed,
        nearnListingId: nearnSlug || null,
        status,
        visibility: vis,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminProjectsListQueryKey }),
        queryClient.invalidateQueries({ queryKey: projectsListQueryKey }),
        router.invalidate(),
      ]);
      toast.success(mode === "create" ? "Project created" : "Project updated");
      onDone?.();
    },
    onError: (err: Error) =>
      toast.error(err.message || (mode === "create" ? "Failed to create" : "Failed to update")),
  });

  const isPending = mutation.isPending;
  const slugOk = mode === "edit" || isValidSlug(slugTrimmed);
  const canSubmit =
    title.trim().length > 0 && slugOk && repositoryTrimmed.length > 0 && repositoryOk && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (mode === "create" && !isValidSlug(slugTrimmed)) {
      toast.error("Enter a valid project slug before creating");
      return;
    }
    if (!repositoryOk) {
      toast.error("Repository must be an http:// or https:// URL");
      return;
    }
    mutation.mutate();
  };

  const nearnHelper = !nearnSlug ? (
    "Mainnet NEARN bounties only. Enter the listing slug."
  ) : resolvedNearnHref ? (
    <a
      href={resolvedNearnHref}
      target="_blank"
      rel="noopener noreferrer"
      className="underline break-all text-foreground hover:text-muted-foreground"
    >
      {resolvedNearnHref}
    </a>
  ) : nearnListingQuery.isFetching ? (
    "Looking up public NEARN link…"
  ) : nearnListingQuery.isError ? (
    "Could not resolve this slug on NEARN."
  ) : (
    "Public link unavailable — check the slug or NEARN sponsor in settings."
  );

  return (
    <Card>
      <CardContent className="p-5 grid gap-4">
        <Field label="title" htmlFor={`project-title-${mode}`}>
          <Input
            id={`project-title-${mode}`}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={isPending}
          />
        </Field>
        <Field
          label="slug"
          htmlFor={`project-slug-${mode}`}
          helper={mode === "create" ? "Auto-generated from the title." : undefined}
        >
          <Input
            id={`project-slug-${mode}`}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/\s+/g, "-")
                  .replace(/[^a-z0-9-]/g, ""),
              );
            }}
            placeholder="lowercase-with-hyphens"
            disabled={isPending || mode === "edit"}
          />
          {mode === "create" && slugTrimmed && !isValidSlug(slugTrimmed) && (
            <p className="text-xs text-destructive">Invalid slug format</p>
          )}
        </Field>
        <Field label="notes" htmlFor={`project-desc-${mode}`}>
          <textarea
            id={`project-desc-${mode}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={isPending}
            className={textareaClass}
          />
        </Field>
        <Field
          label="repository url"
          htmlFor={`project-repo-${mode}`}
          helper="Required. Must start with http:// or https://."
        >
          <Input
            id={`project-repo-${mode}`}
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="https://github.com/org/repo"
            disabled={isPending}
            required
          />
          {repositoryTrimmed && !repositoryOk && (
            <p className="text-xs text-destructive">Enter a full http(s) URL</p>
          )}
        </Field>
        <Field
          label="nearn listing slug (optional)"
          htmlFor={`project-nearn-${mode}`}
          helper={nearnHelper}
        >
          <Input
            id={`project-nearn-${mode}`}
            value={nearnListingId}
            onChange={(e) => setNearnListingId(e.target.value)}
            placeholder="e.g. june2026"
            disabled={isPending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="status" htmlFor={`project-status-${mode}`}>
            <select
              id={`project-status-${mode}`}
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              disabled={isPending}
              className={selectClass}
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label="visibility" htmlFor={`project-vis-${mode}`}>
            <select
              id={`project-vis-${mode}`}
              value={vis}
              onChange={(e) => setVis(e.target.value as Visibility)}
              disabled={isPending}
              className={selectClass}
            >
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isPending
              ? mode === "create"
                ? "creating..."
                : "saving..."
              : mode === "create"
                ? "create project"
                : "save changes"}
          </Button>
          {onDone && (
            <Button type="button" onClick={onDone} variant="outline" disabled={isPending}>
              cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
