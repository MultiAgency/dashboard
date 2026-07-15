import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components";
import { selectClass } from "@/components/admin-form";
import { useApiClient } from "@/lib/api";
import {
  adminAssignmentsListQueryKey,
  adminAssignmentsListQueryOptions,
  adminContributorsListQueryOptions,
} from "@/lib/queries";

export function AssignmentsSection({ projectId }: { projectId: string }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const assignmentsQuery = useQuery({
    queryKey: ["admin", "assignments", projectId],
    queryFn: () => apiClient.assignments.list({ projectId }),
  });
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const allAssignmentsQuery = useQuery(adminAssignmentsListQueryOptions(apiClient));

  const [contributorId, setContributorId] = useState("");
  const [role, setRole] = useState("");

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "assignments", projectId] }),
      queryClient.invalidateQueries({ queryKey: adminAssignmentsListQueryKey }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: async () =>
      apiClient.assignments.create({
        projectId,
        contributorId,
        role: role.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      setContributorId("");
      setRole("");
      toast.success("Contributor assigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to assign contributor"),
  });

  const removeMutation = useMutation({
    mutationFn: async (cid: string) =>
      apiClient.assignments.delete({ projectId, contributorId: cid }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Contributor unassigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to unassign contributor"),
  });

  const assigned = assignmentsQuery.data?.data ?? [];
  const allContributors = contributorsQuery.data?.data ?? [];
  const assignedIds = new Set(assigned.map((a) => a.contributorId));
  const available = allContributors.filter((c) => !assignedIds.has(c.id));

  const otherProjectsByContributor = useMemo(() => {
    const map = new Map<string, Array<{ slug: string; title: string }>>();
    for (const row of allAssignmentsQuery.data?.data ?? []) {
      if (row.projectId === projectId) continue;
      const list = map.get(row.contributorId) ?? [];
      list.push({ slug: row.projectSlug, title: row.projectTitle });
      map.set(row.contributorId, list);
    }
    return map;
  }, [allAssignmentsQuery.data, projectId]);

  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        contributors
      </div>
      {assigned.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contributors assigned.</p>
      ) : (
        <div className="space-y-2">
          {assigned.map((a) => (
            <div
              key={a.contributorId}
              className="rounded-sm border border-border bg-muted/10 p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{a.contributor.name}</div>
                <div className="text-xs text-muted-foreground">
                  {a.role ?? "—"}
                  {a.contributor.nearAccountId && (
                    <span className="ml-2 font-mono">{a.contributor.nearAccountId}</span>
                  )}
                </div>
                {(otherProjectsByContributor.get(a.contributorId) ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(otherProjectsByContributor.get(a.contributorId) ?? []).map((p) => (
                      <Badge key={p.slug} variant="outline" className="font-mono text-[10px]">
                        {p.title}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button
                onClick={() => removeMutation.mutate(a.contributorId)}
                disabled={removeMutation.isPending}
                variant="outline"
                size="sm"
              >
                remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div className="rounded-sm border border-border bg-muted/10 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={contributorId}
              onChange={(e) => setContributorId(e.target.value)}
              disabled={addMutation.isPending}
              className={selectClass}
            >
              <option value="">— pick contributor —</option>
              {available.map((c) => {
                const others = otherProjectsByContributor.get(c.id) ?? [];
                const suffix =
                  others.length > 0 ? ` · also on ${others.map((p) => p.slug).join(", ")}` : "";
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {suffix}
                  </option>
                );
              })}
            </select>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="role (optional)"
              disabled={addMutation.isPending}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!contributorId || addMutation.isPending}
              size="sm"
            >
              {addMutation.isPending ? "adding..." : "assign"}
            </Button>
          </div>
          {contributorId && (otherProjectsByContributor.get(contributorId) ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">
                also assigned:
              </span>
              {(otherProjectsByContributor.get(contributorId) ?? []).map((p) => (
                <Badge key={p.slug} variant="secondary" className="font-mono text-[10px]">
                  {p.title}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        allContributors.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No contributors yet. Create some on{" "}
            <Link to="/admin/contributors" className="underline">
              the contributors page
            </Link>
            .
          </p>
        )
      )}
    </div>
  );
}
