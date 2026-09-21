import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components";
import { Field } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import { agentLinksQueryOptions } from "@/lib/queries";

export function AgentLinksPanel({
  engagementId,
  canManage,
}: {
  engagementId: string;
  canManage: boolean;
}) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const linksQuery = useQuery(agentLinksQueryOptions(apiClient, engagementId));
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const links = linksQuery.data?.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["engagements", "agent-links", engagementId] });

  const create = useMutation({
    mutationFn: () => apiClient.agentLinks.create({ engagementId, label, url }),
    onSuccess: async () => {
      setLabel("");
      setUrl("");
      toast.success("Agent link added");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.agentLinks.remove({ id }),
    onSuccess: async () => {
      toast.success("Agent link removed");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section className="space-y-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        agent links
      </div>
      {linksQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent links yet.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <a
                href={link.url}
                className="underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                {link.label}
              </a>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(link.id)}
                >
                  remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
          <Field label="label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label="url">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              required
            />
          </Field>
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? "adding..." : "add link"}
          </Button>
        </form>
      )}
    </section>
  );
}
