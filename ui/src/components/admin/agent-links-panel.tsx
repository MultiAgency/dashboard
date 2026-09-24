import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Empty, Field, Loading } from "@/components/admin-form";
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

function AgentLinkForm({
  idPrefix,
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  initial: AgentLinkFields;
  pending: boolean;
  submitLabel: string;
  onSubmit: (fields: AgentLinkFields) => void;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [url, setUrl] = useState(initial.url);
  const canSubmit = label.trim() !== "" && url.trim() !== "";

  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ label: label.trim(), url: url.trim() });
      }}
    >
      <Field label="label" htmlFor={`${idPrefix}-label`}>
        <Input
          id={`${idPrefix}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          disabled={pending}
        />
      </Field>
      <Field label="url" htmlFor={`${idPrefix}-url`} helper="Use an http:// or https:// link.">
        <Input
          id={`${idPrefix}-url`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          maxLength={500}
          disabled={pending}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit || pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            cancel
          </Button>
        )}
      </div>
    </form>
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
  const [formKey, setFormKey] = useState(0);

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
    <section className="space-y-3">
      <h2 className="font-display text-xl uppercase font-extrabold">Agent links</h2>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Links to the agents {engagement.client.name} can use through this Engagement. Its members
        see them on their dashboard.
        {engagement.status === "ended" && " The Engagement ended, so they are read-only."}
      </p>
      {linksQuery.isLoading ? (
        <Loading label="Loading agent links" />
      ) : linksQuery.isError ? (
        <AdminError error={linksQuery.error} />
      ) : links.length === 0 ? (
        <Empty label="No agent links yet." />
      ) : (
        <ul className="space-y-2">
          {links.map((link, index) => (
            <li key={link.id} className="rounded-sm border border-border p-3">
              {editing === link.id ? (
                <AgentLinkForm
                  idPrefix={`agent-link-${link.id}`}
                  initial={link}
                  pending={update.isPending}
                  submitLabel="save"
                  onSubmit={(fields) =>
                    update.mutate({ id: link.id, ...fields }, { onSuccess: () => setEditing(null) })
                  }
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <AgentLinkAnchor link={link} />
                    <div className="font-mono text-[11px] text-muted-foreground break-all">
                      {link.url}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move ${link.label} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => reorder.mutate(moveLink(ids, link.id, -1))}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move ${link.label} down`}
                        disabled={index === links.length - 1 || reorder.isPending}
                        onClick={() => reorder.mutate(moveLink(ids, link.id, 1))}
                      >
                        ↓
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(link.id)}>
                        edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoving(link)}>
                        remove
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <AgentLinkForm
          key={formKey}
          idPrefix="new-agent-link"
          initial={{ label: "", url: "" }}
          pending={create.isPending}
          submitLabel="add link"
          onSubmit={(fields) =>
            create.mutate(fields, { onSuccess: () => setFormKey((k) => k + 1) })
          }
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.label ?? "this link"}?`}
        description={`${engagement.client.name} will no longer see it.`}
        confirmLabel="remove"
        destructive
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
        }}
      />
    </section>
  );
}
