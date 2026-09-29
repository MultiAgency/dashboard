import { LightbulbIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EngagementView } from "@/components/engagement-status";
import { IdeaStatusBadge, type IdeaView } from "@/components/idea-status";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApiClient } from "@/lib/api";
import { adminProjectsListQueryOptions, ideasListQueryOptions, refreshAfter } from "@/lib/queries";
import { isSlugTakenError, isValidSlug, slugify } from "@/lib/slugify";
import { isHttpUrl, repositoryUrlError } from "@/lib/url";

type AcceptFields = {
  kind: "project" | "scope";
  title: string;
  slug: string;
  parentSlug?: string;
  repository?: string;
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
  error,
  onEdit,
  onSubmit,
  onCancel,
}: {
  idea: IdeaView;
  clientName: string;
  pending: boolean;
  error: unknown;
  onEdit: () => void;
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
  const [repository, setRepository] = useState("");
  const [share, setShare] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const repositoryTrimmed = repository.trim();
  const repositoryOk = isHttpUrl(repositoryTrimmed);
  const repositoryError = repositoryUrlError(repository, { submitted, error });
  const canSubmit =
    title.trim() !== "" &&
    isValidSlug(slug) &&
    (kind === "project" ? repositoryOk : parentSlug !== "");
  const prefix = `accept-${idea.id}`;
  const titleError = submitted && title.trim() === "";
  const slugError = (submitted || slug !== "") && !isValidSlug(slug);
  const parentError = submitted && parentSlug === "";

  return (
    <form
      noValidate
      className="flex w-full flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!canSubmit) return;
        onSubmit({
          kind,
          title: title.trim(),
          slug,
          parentSlug: kind === "scope" ? parentSlug : undefined,
          repository: kind === "project" ? repositoryTrimmed : undefined,
          share,
        });
      }}
    >
      <FieldSet>
        <FieldLegend variant="label">Turn it into</FieldLegend>
        <RadioGroup
          value={kind}
          onValueChange={(value) => setKind(value === "scope" ? "scope" : "project")}
          className="sm:grid-cols-2"
        >
          <Field orientation="horizontal">
            <RadioGroupItem value="project" id={`${prefix}-kind-project`} />
            <FieldLabel htmlFor={`${prefix}-kind-project`}>A new Project</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem value="scope" id={`${prefix}-kind-scope`} />
            <FieldLabel htmlFor={`${prefix}-kind-scope`}>A scope of a Project</FieldLabel>
          </Field>
        </RadioGroup>
      </FieldSet>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field data-invalid={titleError || undefined}>
          <FieldLabel htmlFor={`${prefix}-title`}>Title</FieldLabel>
          <Input
            id={`${prefix}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            aria-invalid={titleError || undefined}
            disabled={pending}
          />
          {titleError && <FieldError>Enter a title</FieldError>}
        </Field>
        <Field data-invalid={slugError || undefined}>
          <FieldLabel htmlFor={`${prefix}-slug`}>Slug</FieldLabel>
          <Input
            id={`${prefix}-slug`}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={80}
            aria-invalid={slugError || undefined}
            disabled={pending}
          />
          {slugError && <FieldError>Use lowercase letters, numbers and dashes</FieldError>}
        </Field>
        {kind === "scope" ? (
          <Field data-invalid={parentError || undefined} className="sm:col-span-2">
            <FieldLabel htmlFor={`${prefix}-parent`}>Parent Project</FieldLabel>
            <Select value={parentSlug} onValueChange={setParentSlug}>
              <SelectTrigger
                id={`${prefix}-parent`}
                className="w-full"
                aria-invalid={parentError || undefined}
              >
                <SelectValue placeholder="Choose a Project" />
              </SelectTrigger>
              <SelectContent>
                {parents.map((p) => (
                  <SelectItem key={p.id} value={p.slug}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {parentError && <FieldError>Choose the Project this scope belongs to</FieldError>}
          </Field>
        ) : (
          <Field data-invalid={repositoryError !== null || undefined} className="sm:col-span-2">
            <FieldLabel htmlFor={`${prefix}-repository`}>Repository URL</FieldLabel>
            <Input
              id={`${prefix}-repository`}
              value={repository}
              onChange={(e) => {
                setRepository(e.target.value);
                onEdit();
              }}
              placeholder="https://github.com/org/repo"
              aria-invalid={repositoryError !== null || undefined}
              disabled={pending}
              required
            />
            {repositoryError ? (
              <FieldError>{repositoryError}</FieldError>
            ) : (
              <FieldDescription>Required. Starts with http:// or https://.</FieldDescription>
            )}
          </Field>
        )}
      </div>
      <Field orientation="horizontal">
        <Checkbox
          id={`${prefix}-share`}
          checked={share}
          onCheckedChange={(checked) => setShare(checked === true)}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${prefix}-share`}>Share it with {clientName}</FieldLabel>
          <FieldDescription>
            Through this Engagement, so their members can follow it.
          </FieldDescription>
        </FieldContent>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Accepting…" : "Accept idea"}
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
    <Card>
      <CardHeader>
        <CardTitle>Ideas</CardTitle>
        <CardDescription>
          Ideas {engagement.client.name} submitted. Accept one to turn it into a Project or scope,
          or decline it; they are told either way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ideasQuery.isLoading ? (
          <div className="flex flex-col gap-2">
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
                Ideas {engagement.client.name} submits show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {ideas.map((idea) => (
              <Item key={idea.id} asChild variant="outline">
                <li>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{idea.title}</ItemTitle>
                    <ItemDescription>
                      Submitted {new Date(idea.createdAt).toISOString().slice(0, 10)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <IdeaStatusBadge status={idea.status} />
                  </ItemActions>
                  {idea.description && (
                    <p className="basis-full text-sm whitespace-pre-wrap text-muted-foreground">
                      {idea.description}
                    </p>
                  )}
                  {idea.result && (
                    <ItemFooter className="justify-start">
                      <Link
                        to="/admin/projects/$slug"
                        params={{ slug: idea.result.slug }}
                        className="underline underline-offset-4 hover:text-foreground"
                      >
                        Became {idea.result.title}
                      </Link>
                      <Badge variant="secondary">
                        {idea.result.shared ? "Shared" : "Not shared"}
                      </Badge>
                    </ItemFooter>
                  )}
                  {decidable && idea.status === "new" && accepting !== idea.id && (
                    <ItemFooter className="justify-end">
                      <Button variant="outline" onClick={() => setDeclining(idea)}>
                        Decline
                      </Button>
                      <Button
                        onClick={() => {
                          accept.reset();
                          setAccepting(idea.id);
                        }}
                      >
                        Accept
                      </Button>
                    </ItemFooter>
                  )}
                  {accepting === idea.id && (
                    <div className="flex basis-full flex-col gap-4">
                      <Separator />
                      <AcceptIdeaForm
                        idea={idea}
                        clientName={engagement.client.name}
                        pending={accept.isPending}
                        error={accept.error}
                        onEdit={() => {
                          if (accept.error) accept.reset();
                        }}
                        onCancel={() => {
                          accept.reset();
                          setAccepting(null);
                        }}
                        onSubmit={(fields) =>
                          accept.mutate(
                            { id: idea.id, ...fields },
                            { onSuccess: () => setAccepting(null) },
                          )
                        }
                      />
                    </div>
                  )}
                </li>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
        title={`Decline ${declining?.title ?? "this idea"}?`}
        description={`${engagement.client.name} will see it as declined.`}
        confirmLabel="Decline"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (declining) await decline.mutateAsync(declining.id);
        }}
      />
    </Card>
  );
}
