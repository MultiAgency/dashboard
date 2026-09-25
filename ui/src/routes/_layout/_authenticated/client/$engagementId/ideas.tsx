import { InfoIcon, LightbulbIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  SectionHeader,
  Skeleton,
  Spinner,
  Textarea,
} from "@/components";
import { AdminError } from "@/components/admin-error";
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
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        Suggest work to {engagement.agency.name}. They accept an idea by turning it into a Project
        or scope, or decline it; you see the decision here.
      </p>
      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Submit an idea</CardTitle>
            <CardDescription>
              {engagement.agency.name} is notified and decides what to do with it.
            </CardDescription>
          </CardHeader>
          <form
            className="flex flex-col gap-(--card-spacing)"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) submit.mutate();
            }}
          >
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="idea-title">Idea</FieldLabel>
                  <Input
                    id="idea-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Monthly progress reports"
                    disabled={submit.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="idea-description">Details (optional)</FieldLabel>
                  <Textarea
                    id="idea-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={4000}
                    rows={4}
                    disabled={submit.isPending}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={!title.trim() || submit.isPending}>
                {submit.isPending && <Spinner data-icon="inline-start" />}
                Submit idea
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : (
        <Alert>
          <InfoIcon aria-hidden />
          <AlertTitle>This Engagement ended</AlertTitle>
          <AlertDescription>No new ideas can be submitted.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <SectionHeader title="Submitted ideas" />
        {ideasQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Loading ideas</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : ideasQuery.isError ? (
          <AdminError error={ideasQuery.error} />
        ) : ideas.length === 0 ? (
          <Empty variant="outline">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LightbulbIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No ideas yet</EmptyTitle>
              <EmptyDescription>
                Ideas you submit and their decisions show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {ideas.map((idea) => (
              <li key={idea.id}>
                <Item variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <h3 className="text-xs font-medium break-words">{idea.title}</h3>
                    {idea.description && (
                      <p className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
                        {idea.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                      <span>Submitted {new Date(idea.createdAt).toISOString().slice(0, 10)}</span>
                      {idea.decidedAt && (
                        <span>Decided {new Date(idea.decidedAt).toISOString().slice(0, 10)}</span>
                      )}
                      {idea.result && (
                        <Link
                          to="/client/$engagementId/projects/$slug"
                          params={{ engagementId: engagement.id, slug: idea.result.slug }}
                          className="text-foreground underline underline-offset-4"
                        >
                          Became {idea.result.title}
                        </Link>
                      )}
                    </div>
                  </ItemContent>
                  <ItemActions>
                    <IdeaStatusBadge status={idea.status} />
                  </ItemActions>
                </Item>
              </li>
            ))}
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
