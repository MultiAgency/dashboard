import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { ideasQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_layout/_authenticated/client/ideas/")({
  component: ClientIdeas,
});

function ClientIdeas() {
  const { engagement, engagementId } = Route.useRouteContext();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const ideasQuery = useQuery(ideasQueryOptions(apiClient, engagementId));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const ideas = ideasQuery.data?.data ?? [];
  const canSubmit = engagement.status === "active";

  const submitIdea = useMutation({
    mutationFn: () =>
      apiClient.ideas.submit({
        engagementId,
        title,
        description: description.trim() || undefined,
      }),
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      toast.success("Idea submitted");
      await queryClient.invalidateQueries({ queryKey: ["engagements", "ideas", engagementId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    submitIdea.mutate();
  };

  if (ideasQuery.isError) return <AdminError error={ideasQuery.error} />;

  return (
    <div className="space-y-6">
      {canSubmit && (
        <Card>
          <CardContent>
            <form className="space-y-3" onSubmit={submit}>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                new idea
              </div>
              <Field label="title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </Field>
              <Field label="description">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Button type="submit" size="sm" disabled={submitIdea.isPending}>
                {submitIdea.isPending ? "submitting..." : "submit idea"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {ideasQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : ideas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ideas yet.</p>
      ) : (
        <ul className="space-y-3">
          {ideas.map((idea) => (
            <li key={idea.projectId}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-display text-lg uppercase tracking-tight font-bold">
                      {idea.title}
                    </div>
                    {idea.description && (
                      <p className="text-sm text-muted-foreground">{idea.description}</p>
                    )}
                  </div>
                  <Badge variant="outline">{idea.status}</Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
