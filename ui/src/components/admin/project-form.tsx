import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FieldError,
  FieldGroup,
  Input,
  Textarea,
} from "@/components";
import { ChoiceSelect, Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { nearnListingHref } from "@/lib/nearn";
import {
  adminNearnListingQueryOptions,
  adminProjectsListQueryOptions,
  publicSettingsQueryOptions,
  refreshAfter,
} from "@/lib/queries";
import { isSlugTakenError, isValidSlug, slugify, suggestSlug } from "@/lib/slugify";
import { isHttpUrl } from "@/lib/url";

export type ProjectStatus = "active" | "paused" | "archived";
export type Visibility = "public" | "unlisted" | "private";
export type ProjectKind = "project" | "idea" | "scope" | "result";

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
  const [kind, setKind] = useState<ProjectKind>("project");
  const [parentSlug, setParentSlug] = useState("");

  const nearnSlug = nearnListingId.trim();
  const settingsQuery = useQuery(publicSettingsQueryOptions(apiClient));
  const projectsQuery = useQuery(adminProjectsListQueryOptions(apiClient));
  const parentOptions = (projectsQuery.data?.data ?? []).filter((p) =>
    kind === "scope" ? (p as { kind?: string }).kind !== "result" : true,
  );
  const nearnListingQuery = useQuery(adminNearnListingQueryOptions(apiClient, nearnSlug));

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
          repository: kind === "project" ? repositoryTrimmed : undefined,
          nearnListingId: nearnSlug || undefined,
          kind,
          parentSlug: kind === "scope" || kind === "result" ? parentSlug.trim() : undefined,
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
      await Promise.all([refreshAfter(queryClient, { type: "projects" }), router.invalidate()]);
      toast.success(mode === "create" ? "Project created" : "Project updated");
      onDone?.();
    },
    onError: (err: Error) => {
      if (isSlugTakenError(err)) return;
      toast.error(err.message || (mode === "create" ? "Failed to create" : "Failed to update"));
    },
  });

  const isPending = mutation.isPending;
  const slugOk = mode === "edit" || isValidSlug(slugTrimmed);
  const repositoryRequired = kind === "project";
  const canSubmit =
    title.trim().length > 0 &&
    slugOk &&
    (!repositoryRequired || (repositoryTrimmed.length > 0 && repositoryOk)) &&
    (kind === "project" || kind === "idea" || parentSlug.trim().length > 0) &&
    !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (mode === "create" && !isValidSlug(slugTrimmed)) {
      toast.error("Enter a valid project slug before creating");
      return;
    }
    if (repositoryRequired && !repositoryOk) {
      toast.error("Repository must be an http:// or https:// URL");
      return;
    }
    mutation.mutate();
  };

  const nearnHelper = !nearnSlug ? (
    "Mainnet NEARN bounties only. Enter the listing slug."
  ) : resolvedNearnHref ? (
    <a href={resolvedNearnHref} target="_blank" rel="noopener noreferrer" className="break-all">
      {resolvedNearnHref}
    </a>
  ) : nearnListingQuery.isFetching ? (
    "Looking up public NEARN link…"
  ) : nearnListingQuery.isError ? (
    "Could not resolve this slug on NEARN."
  ) : (
    "Public link unavailable — check the slug or NEARN sponsor in settings."
  );

  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "paused", label: "Paused" },
    { value: "archived", label: "Archived" },
  ];
  const visibilityOptions = [
    { value: "private", label: "Private" },
    { value: "unlisted", label: "Unlisted" },
    { value: "public", label: "Public" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{mode === "create" ? "New project" : "Project details"}</h2>
        </CardTitle>
        <CardDescription>
          {mode === "create"
            ? "Projects hold the team, budget and billings for work you deliver."
            : "Title, notes, repository, NEARN link, status and visibility."}
        </CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <CardContent>
          <FieldGroup>
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field label="Title" htmlFor={`project-title-${mode}`}>
                <Input
                  id={`project-title-${mode}`}
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field
                label="Slug"
                htmlFor={`project-slug-${mode}`}
                helper={
                  mode === "create" ? "Generated from the title." : "The slug can't be changed."
                }
              >
                <Input
                  id={`project-slug-${mode}`}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    mutation.reset();
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    );
                  }}
                  placeholder="lowercase-with-hyphens"
                  disabled={isPending || mode === "edit"}
                  aria-invalid={
                    (mode === "create" && slugTrimmed && !isValidSlug(slugTrimmed)) ||
                    isSlugTakenError(mutation.error)
                      ? true
                      : undefined
                  }
                />
                {mode === "create" && slugTrimmed && !isValidSlug(slugTrimmed) && (
                  <FieldError>Invalid slug format</FieldError>
                )}
                {isSlugTakenError(mutation.error) && (
                  <FieldError>
                    “{slugTrimmed}” is already taken.{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={() => {
                        setSlug(suggestSlug(slugTrimmed));
                        mutation.reset();
                      }}
                    >
                      Try “{suggestSlug(slugTrimmed)}”
                    </Button>
                  </FieldError>
                )}
              </Field>
            </div>
            <Field label="Notes" htmlFor={`project-desc-${mode}`}>
              <Textarea
                id={`project-desc-${mode}`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isPending}
              />
            </Field>
            {mode === "create" && (
              <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
                <Field label="Kind" htmlFor={`project-kind-${mode}`}>
                  <ChoiceSelect
                    id={`project-kind-${mode}`}
                    value={kind}
                    onValueChange={(value) => setKind(value as ProjectKind)}
                    disabled={isPending}
                    options={[
                      { value: "project", label: "Project" },
                      { value: "idea", label: "Idea" },
                      { value: "scope", label: "Scope" },
                      { value: "result", label: "Result" },
                    ]}
                  />
                </Field>
                {(kind === "scope" || kind === "result") && (
                  <Field
                    label={kind === "scope" ? "Parent project" : "Parent scope"}
                    htmlFor={`project-parent-${mode}`}
                    helper={
                      kind === "scope"
                        ? "A scope belongs to a parent project."
                        : "A result belongs to a parent scope."
                    }
                  >
                    <ChoiceSelect
                      id={`project-parent-${mode}`}
                      value={parentSlug}
                      onValueChange={setParentSlug}
                      disabled={isPending}
                      placeholder="Select a parent"
                      options={parentOptions.map((p) => ({
                        value: p.slug,
                        label: `${p.title} (@${p.slug})`,
                      }))}
                    />
                  </Field>
                )}
              </div>
            )}
            <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
              <Field
                label="Repository URL"
                htmlFor={`project-repo-${mode}`}
                helper={
                  repositoryRequired
                    ? "Required. Starts with http:// or https://."
                    : "Optional for ideas, scopes and results."
                }
              >
                <Input
                  id={`project-repo-${mode}`}
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  disabled={isPending}
                  required={repositoryRequired}
                  aria-invalid={
                    repositoryRequired && repositoryTrimmed && !repositoryOk ? true : undefined
                  }
                />
                {repositoryRequired && repositoryTrimmed && !repositoryOk && (
                  <FieldError>Enter a full http(s) URL</FieldError>
                )}
              </Field>
              <Field
                label="NEARN listing slug"
                htmlFor={`project-nearn-${mode}`}
                helper={nearnHelper}
              >
                <Input
                  id={`project-nearn-${mode}`}
                  value={nearnListingId}
                  onChange={(e) => setNearnListingId(e.target.value)}
                  placeholder="Optional, e.g. june2026"
                  disabled={isPending}
                />
              </Field>
              <Field label="Status" htmlFor={`project-status-${mode}`}>
                <ChoiceSelect
                  id={`project-status-${mode}`}
                  value={status}
                  onValueChange={(value) => setStatus(value as ProjectStatus)}
                  disabled={isPending}
                  options={statusOptions}
                />
              </Field>
              <Field label="Visibility" htmlFor={`project-vis-${mode}`}>
                <ChoiceSelect
                  id={`project-vis-${mode}`}
                  value={vis}
                  onValueChange={(value) => setVis(value as Visibility)}
                  disabled={isPending}
                  options={visibilityOptions}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {onDone && (
            <Button type="button" onClick={onDone} variant="outline" disabled={isPending}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit}>
            {isPending
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
                ? "Create project"
                : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
