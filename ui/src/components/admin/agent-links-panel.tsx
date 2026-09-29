import {
  ArrowDownIcon,
  ArrowUpIcon,
  LinkSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
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
  FieldDescription,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { AgentLinkAnchor, type AgentLinkView } from "@/components/agent-links";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EngagementView } from "@/components/engagement-status";
import { moveLink } from "@/lib/agent-links";
import { useApiClient } from "@/lib/api";
import { agentLinksListQueryOptions, refreshAfter } from "@/lib/queries";

type AgentLinkFields = { label: string; url: string };

function useAgentLinkMutation<TInput>(
  action: (input: TInput) => Promise<unknown>,
  success: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await refreshAfter(queryClient, { type: "agentLinks" });
      toast.success(success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function useLinkFields(initial: AgentLinkFields) {
  const [label, setLabel] = useState(initial.label);
  const [url, setUrl] = useState(initial.url);
  return {
    label,
    url,
    setLabel,
    setUrl,
    canSubmit: label.trim() !== "" && url.trim() !== "",
    values: { label: label.trim(), url: url.trim() },
  };
}

function LinkFields({
  idPrefix,
  fields,
  pending,
}: {
  idPrefix: string;
  fields: ReturnType<typeof useLinkFields>;
  pending: boolean;
}) {
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-label`}>Label</FieldLabel>
        <Input
          id={`${idPrefix}-label`}
          value={fields.label}
          onChange={(e) => fields.setLabel(e.target.value)}
          placeholder="Standup notes"
          maxLength={120}
          disabled={pending}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-url`}>URL</FieldLabel>
        <Input
          id={`${idPrefix}-url`}
          inputMode="url"
          value={fields.url}
          onChange={(e) => fields.setUrl(e.target.value)}
          placeholder="https://"
          maxLength={500}
          disabled={pending}
        />
        <FieldDescription>Use an http:// or https:// link.</FieldDescription>
      </Field>
    </div>
  );
}

function EditLinkForm({
  link,
  pending,
  onSubmit,
  onCancel,
}: {
  link: AgentLinkView;
  pending: boolean;
  onSubmit: (fields: AgentLinkFields) => void;
  onCancel: () => void;
}) {
  const fields = useLinkFields(link);
  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (fields.canSubmit) onSubmit(fields.values);
      }}
    >
      <LinkFields idPrefix={`agent-link-${link.id}`} fields={fields} pending={pending} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!fields.canSubmit || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function AddLinkCard({
  clientName,
  pending,
  onSubmit,
}: {
  clientName: string;
  pending: boolean;
  onSubmit: (fields: AgentLinkFields, reset: () => void) => void;
}) {
  const [formKey, setFormKey] = useState(0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an agent link</CardTitle>
        <CardDescription>{clientName}'s members see it on their dashboard.</CardDescription>
      </CardHeader>
      <AddLinkForm
        key={formKey}
        pending={pending}
        onSubmit={(fields) => onSubmit(fields, () => setFormKey((k) => k + 1))}
      />
    </Card>
  );
}

function AddLinkForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (fields: AgentLinkFields) => void;
}) {
  const fields = useLinkFields({ label: "", url: "" });
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (fields.canSubmit) onSubmit(fields.values);
      }}
    >
      <CardContent>
        <LinkFields idPrefix="new-agent-link" fields={fields} pending={pending} />
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-3">
        {!fields.canSubmit && (
          <p className="mr-auto text-xs text-muted-foreground">Enter a label and a URL.</p>
        )}
        <Button type="submit" disabled={!fields.canSubmit || pending}>
          {pending ? "Adding…" : "Add link"}
        </Button>
      </CardFooter>
    </form>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

export function AgentLinksPanel({
  engagement,
  canManage,
}: {
  engagement: EngagementView;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const linksQuery = useQuery(agentLinksListQueryOptions(apiClient, engagement.id));
  const links = linksQuery.data?.data ?? [];
  const editable = canManage && engagement.status === "active";
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgentLinkView | null>(null);

  const create = useAgentLinkMutation(
    (fields: AgentLinkFields) =>
      apiClient.agentLinks.create({ engagementId: engagement.id, ...fields }),
    "Agent link added",
  );
  const update = useAgentLinkMutation(
    (input: AgentLinkFields & { id: string }) => apiClient.agentLinks.update(input),
    "Agent link saved",
  );
  const reorder = useAgentLinkMutation(
    (ids: string[]) => apiClient.agentLinks.reorder({ engagementId: engagement.id, ids }),
    "Order saved",
  );
  const remove = useAgentLinkMutation(
    (id: string) => apiClient.agentLinks.remove({ id }),
    "Agent link removed",
  );
  const ids = links.map((l) => l.id);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Agent links</CardTitle>
          <CardDescription>
            {engagement.status === "ended"
              ? "The Engagement ended, so these links are read-only."
              : `Agents ${engagement.client.name} can use through this Engagement.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linksQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : linksQuery.isError ? (
            <AdminError error={linksQuery.error} />
          ) : links.length === 0 ? (
            <Empty variant="outline">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LinkSimpleIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No agent links yet</EmptyTitle>
                <EmptyDescription>
                  {editable ? "Add the first one below." : "Links the Agency adds show up here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {links.map((link, index) => (
                <Item key={link.id} asChild variant="outline" size="sm">
                  <li>
                    {editing === link.id ? (
                      <EditLinkForm
                        link={link}
                        pending={update.isPending}
                        onSubmit={(fields) =>
                          update.mutate(
                            { id: link.id, ...fields },
                            { onSuccess: () => setEditing(null) },
                          )
                        }
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <ItemContent className="min-w-0">
                          <AgentLinkAnchor link={link} />
                          <ItemDescription className="break-all">{link.url}</ItemDescription>
                        </ItemContent>
                        {editable && (
                          <ItemActions>
                            <IconAction
                              label={`Move ${link.label} up`}
                              disabled={index === 0 || reorder.isPending}
                              onClick={() => reorder.mutate(moveLink(ids, link.id, -1))}
                            >
                              <ArrowUpIcon aria-hidden />
                            </IconAction>
                            <IconAction
                              label={`Move ${link.label} down`}
                              disabled={index === links.length - 1 || reorder.isPending}
                              onClick={() => reorder.mutate(moveLink(ids, link.id, 1))}
                            >
                              <ArrowDownIcon aria-hidden />
                            </IconAction>
                            <IconAction
                              label={`Edit ${link.label}`}
                              onClick={() => setEditing(link.id)}
                            >
                              <PencilSimpleIcon aria-hidden />
                            </IconAction>
                            <IconAction
                              label={`Remove ${link.label}`}
                              onClick={() => setRemoving(link)}
                            >
                              <TrashIcon aria-hidden />
                            </IconAction>
                          </ItemActions>
                        )}
                      </>
                    )}
                  </li>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
      {editable && (
        <AddLinkCard
          clientName={engagement.client.name}
          pending={create.isPending}
          onSubmit={(fields, reset) => create.mutate(fields, { onSuccess: reset })}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.label ?? "this link"}?`}
        description={`${engagement.client.name} will no longer see it.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
        }}
      />
    </div>
  );
}
