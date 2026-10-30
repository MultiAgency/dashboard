import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { type ApiClient, useApiClient } from "@/lib/api";
import { refreshAfter } from "@/lib/queries";
import { isSlugTakenError, slugify } from "@/lib/slugify";
import { isHttpUrl } from "@/lib/url";

type CreatedProject = Awaited<ReturnType<ApiClient["agency"]["projects"]["create"]>>["project"];

const SLUG_ATTEMPTS = 5;

export function QuickCreateProject({
  onCreated,
  onCancel,
}: {
  onCreated: (project: CreatedProject) => void;
  onCancel?: () => void;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [repository, setRepository] = useState("");
  const repositoryTrimmed = repository.trim();
  const repositoryOk = isHttpUrl(repositoryTrimmed);

  const create = useMutation({
    mutationFn: async () => {
      const base = slugify(title) || "project";
      let slug = base;
      for (let attempt = 0; ; attempt++) {
        try {
          const { project } = await apiClient.agency.projects.create({
            slug,
            title: title.trim(),
            repository: repositoryTrimmed,
            kind: "project",
            status: "active",
            visibility: "private",
          });
          return project;
        } catch (err) {
          if (!isSlugTakenError(err) || attempt >= SLUG_ATTEMPTS) throw err;
          const suffix = `-${attempt + 2}`;
          slug = `${base.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
        }
      }
    },
    onSuccess: async (project) => {
      await refreshAfter(queryClient, { type: "projects" });
      toast.success(`${project.title} created`);
      onCreated(project);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create the project"),
  });

  const canSubmit = title.trim() !== "" && repositoryOk && !create.isPending;
  const submit = () => {
    if (canSubmit) create.mutate();
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">New project</p>
      <Field label="Name" htmlFor="qc-project-title">
        <Input
          id="qc-project-title"
          value={title}
          disabled={create.isPending}
          onKeyDown={onEnter}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field label="Repository URL" htmlFor="qc-project-repo">
        <Input
          id="qc-project-repo"
          type="url"
          placeholder="https://github.com/owner/name"
          value={repository}
          disabled={create.isPending}
          aria-invalid={repositoryTrimmed !== "" && !repositoryOk ? true : undefined}
          onKeyDown={onEnter}
          onChange={(e) => setRepository(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
          {create.isPending ? "Creating…" : "Create project"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={create.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
