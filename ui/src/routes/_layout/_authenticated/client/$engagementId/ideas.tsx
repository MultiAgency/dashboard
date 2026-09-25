import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading, textareaClass } from "@/components/admin-form";
import { IdeaStatusBadge } from "@/components/idea-status";
import { useApiClient } from "@/lib/api";
import { acceptsIdeas } from "@/lib/navigation";
import { ideasListQueryOptions, refreshAfter } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/$engagementId/ideas")({
  beforeLoad: ({ context, params }) => {
    if (!acceptsIdeas(context.engagement.kind)) {
      throw redirect({ to: "/client/$engagementId", params });
    }
  },
  component: ClientIdeasPage,
});

function ClientIdeasPage() {
  const { engagement } = Route.useRouteContext();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const ideasQuery = useQuery(ideasListQueryOptions(apiClient, engagement.id));
  const ideas = ideasQuery.data?.data ?? [];
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const active = engagement.status === "active";

  const submit = useMutation({
    mutationFn: () =>
      apiClient.ideas.submit({
        engagementId: engagement.id,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      await refreshAfter(queryClient, { type: "ideas" });
      toast.success(`Idea sent to ${engagement.agency.name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Suggest work to {engagement.agency.name}. They accept an idea by turning it into a Project
        or scope, or decline it; you see the decision here.
      </p>
      {active ? (
        <Card>
          <CardContent className="p-5">
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) submit.mutate();
              }}
            >
              <Field label="idea" htmlFor="idea-title">
                <Input
                  id="idea-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Monthly progress reports"
                  disabled={submit.isPending}
                />
              </Field>
              <Field label="details (optional)" htmlFor="idea-description">
                <textarea
                  id="idea-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  className={textareaClass}
                  disabled={submit.isPending}
                />
              </Field>
              <div>
                <Button type="submit" size="sm" disabled={!title.trim() || submit.isPending}>
                  {submit.isPending ? "sending..." : "submit idea"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          This Engagement ended, so no new ideas can be submitted.
        </p>
      )}

      {ideasQuery.isLoading ? (
        <Loading label="Loading ideas" />
      ) : ideasQuery.isError ? (
        <AdminError error={ideasQuery.error} />
      ) : ideas.length === 0 ? (
        <Empty label="No ideas submitted yet." />
      ) : (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li key={idea.id} className="rounded-sm border border-border p-3 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm uppercase font-bold">{idea.title}</span>
                <IdeaStatusBadge status={idea.status} />
              </div>
              {idea.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {idea.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>submitted {new Date(idea.createdAt).toISOString().slice(0, 10)}</span>
                {idea.decidedAt && (
                  <span>decided {new Date(idea.decidedAt).toISOString().slice(0, 10)}</span>
                )}
                {idea.result && (
                  <Link
                    to="/client/$engagementId/projects/$slug"
                    params={{ engagementId: engagement.id, slug: idea.result.slug }}
                    className="underline hover:text-foreground"
                  >
                    became {idea.result.title}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
