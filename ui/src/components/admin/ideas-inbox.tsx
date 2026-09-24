import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, selectClass } from "@/components/admin-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EngagementView } from "@/components/engagement-status";
import { IdeaStatusBadge, type IdeaView } from "@/components/idea-status";
import { useApiClient } from "@/lib/api";
import { adminProjectsListQueryOptions, ideasListQueryOptions, refreshAfter } from "@/lib/queries";
import { isSlugTakenError, isValidSlug, slugify } from "@/lib/slugify";

type AcceptFields = {
  kind: "project" | "scope";
  title: string;
  slug: string;
  parentSlug?: string;
  share: boolean;
};

function useIdeaMutation<TInput>(action: (input: TInput) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "ideas" });
      toast.success(success);
    },
    onError: (e: Error) =>
      toast.error(isSlugTakenError(e) ? "This slug is taken. Choose another one." : e.message),
  });
}

function AcceptIdeaForm({
  idea,
  clientName,
  pending,
  onSubmit,
  onCancel,
}: {
  idea: IdeaView;
  clientName: string;
  pending: boolean;
  onSubmit: (fields: AcceptFields) => void;
  onCancel: () => void;
}) {
  const apiClient = useApiClient();
  const parents = (useQuery(adminProjectsListQueryOptions(apiClient)).data?.data ?? []).filter(
    (p) => p.kind === "project",
  );
  const [kind, setKind] = useState<AcceptFields["kind"]>("project");
  const [title, setTitle] = useState(idea.title);
  const [slug, setSlug] = useState(slugify(idea.title));
  const [parentSlug, setParentSlug] = useState("");
  const [share, setShare] = useState(true);
  const canSubmit =
    title.trim() !== "" && isValidSlug(slug) && (kind === "project" || parentSlug !== "");
  const prefix = `accept-${idea.id}`;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          kind,
          title: title.trim(),
          slug,
          parentSlug: kind === "scope" ? parentSlug : undefined,
          share,
        });
      }}
    >
      <Field label="turn into" htmlFor={`${prefix}-kind`}>
        <select
          id={`${prefix}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value === "scope" ? "scope" : "project")}
          className={selectClass}
        >
          <option value="project">a new Project</option>
          <option value="scope">a scope of a Project</option>
        </select>
      </Field>
      {kind === "scope" && (
        <Field label="parent project" htmlFor={`${prefix}-parent`}>
          <select
            id={`${prefix}-parent`}
            value={parentSlug}
            onChange={(e) => setParentSlug(e.target.value)}
            className={selectClass}
          >
            <option value="">choose a project</option>
            {parents.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="title" htmlFor={`${prefix}-title`}>
        <Input
          id={`${prefix}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          disabled={pending}
        />
      </Field>
      <Field label="slug" htmlFor={`${prefix}-slug`}>
        <Input
          id={`${prefix}-slug`}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          maxLength={80}
          aria-invalid={slug !== "" && !isValidSlug(slug)}
          disabled={pending}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Share it with {clientName} through this Engagement
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={!canSubmit || pending}>
          {pending ? "accepting..." : "accept"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          cancel
        </Button>
      </div>
    </form>
  );
}

export function IdeasInbox({
  engagement,
  canManage,
}: {
  engagement: EngagementView;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const ideasQuery = useQuery(ideasListQueryOptions(apiClient, engagement.id));
  const ideas = ideasQuery.data?.data ?? [];
  const decidable = canManage && engagement.status === "active";
  const [accepting, setAccepting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<IdeaView | null>(null);

  const accept = useIdeaMutation(
    (input: AcceptFields & { id: string }) => apiClient.ideas.accept(input),
    "Idea accepted",
  );
  const decline = useIdeaMutation((id: string) => apiClient.ideas.decline({ id }), "Idea declined");

  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl uppercase font-extrabold">Ideas</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Ideas {engagement.client.name} submitted. They are private Projects of kind idea that you
        own. Accept one to turn it into a Project or scope, or decline it; {engagement.client.name}{" "}
        is told either way.
      </p>
      {ideasQuery.isLoading ? (
        <Loading label="Loading ideas" />
      ) : ideasQuery.isError ? (
        <AdminError error={ideasQuery.error} />
      ) : ideas.length === 0 ? (
        <Empty label="No ideas yet." />
      ) : (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li key={idea.id} className="rounded-sm border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-sm uppercase font-bold">{idea.title}</span>
                <IdeaStatusBadge status={idea.status} />
              </div>
              {idea.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {idea.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span>submitted {new Date(idea.createdAt).toISOString().slice(0, 10)}</span>
                {idea.result && (
                  <>
                    <Link
                      to="/admin/projects/$slug"
                      params={{ slug: idea.result.slug }}
                      className="underline hover:text-foreground"
                    >
                      became {idea.result.title}
                    </Link>
                    <Badge variant="secondary">
                      {idea.result.shared ? "shared" : "not shared"}
                    </Badge>
                  </>
                )}
              </div>
              {decidable && idea.status === "new" && accepting !== idea.id && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setAccepting(idea.id)}>
                    accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeclining(idea)}>
                    decline
                  </Button>
                </div>
              )}
              {accepting === idea.id && (
                <AcceptIdeaForm
                  idea={idea}
                  clientName={engagement.client.name}
                  pending={accept.isPending}
                  onCancel={() => setAccepting(null)}
                  onSubmit={(fields) =>
                    accept.mutate(
                      { id: idea.id, ...fields },
                      { onSuccess: () => setAccepting(null) },
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
        title={`Decline ${declining?.title ?? "this idea"}?`}
        description={`${engagement.client.name} will see it as declined.`}
        confirmLabel="decline"
        destructive
        onConfirm={async () => {
          if (declining) await decline.mutateAsync(declining.id);
        }}
      />
    </section>
  );
}
