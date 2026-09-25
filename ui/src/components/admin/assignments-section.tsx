import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Input } from "@/components";
import { useApiClient } from "@/lib/api";
import {
  adminAssignmentsForProjectQueryKey,
  adminAssignmentsListQueryOptions,
  adminContributorsListQueryOptions,
  refreshAfter,
} from "@/lib/queries";

type AssignmentsSectionProps = {
  projectId: string;
  readOnly?: boolean;
};

export function AssignmentsSection({ projectId, readOnly = false }: AssignmentsSectionProps) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const assignmentsQuery = useQuery({
    queryKey: adminAssignmentsForProjectQueryKey(projectId),
    queryFn: () => apiClient.assignments.list({ projectId }),
  });
  const contributorsQuery = useQuery(adminContributorsListQueryOptions(apiClient));
  const allAssignmentsQuery = useQuery(adminAssignmentsListQueryOptions(apiClient));

  const [nearAccount, setNearAccount] = useState("");
  const [role, setRole] = useState("");

  const invalidate = async () => {
    await refreshAfter(queryClient, { type: "assignments" });
  };

  const addMutation = useMutation({
    mutationFn: async () =>
      apiClient.assignments.create({
        projectId,
        nearAccount,
        role: role.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      setNearAccount("");
      setRole("");
      toast.success("Builder assigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to assign builder"),
  });

  const removeMutation = useMutation({
    mutationFn: async (account: string) =>
      apiClient.assignments.delete({ projectId, nearAccount: account }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Builder unassigned");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to unassign builder"),
  });

  const assigned = assignmentsQuery.data?.data ?? [];
  const allContributors = contributorsQuery.data?.data ?? [];
  const assignedAccounts = new Set(assigned.map((a) => a.nearAccount));
  const available = allContributors.filter((c) => !assignedAccounts.has(c.nearAccount));
  const builderOptions = `builders-${projectId}`;
  const contributorByNear = new Map(allContributors.map((c) => [c.nearAccount, c]));

  const otherProjectsByContributor = useMemo(() => {
    const map = new Map<string, Array<{ slug: string; title: string }>>();
    for (const row of allAssignmentsQuery.data?.data ?? []) {
      if (row.projectId === projectId) continue;
      const list = map.get(row.nearAccount) ?? [];
      list.push({ slug: row.projectSlug, title: row.projectTitle });
      map.set(row.nearAccount, list);
    }
    return map;
  }, [allAssignmentsQuery.data, projectId]);

  return (
    <div className="space-y-3">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        builders
      </div>
      {assigned.length === 0 ? (
        <p className="text-xs text-muted-foreground">No builders assigned.</p>
      ) : (
        <div className="space-y-2">
          {assigned.map((a) => {
            const contributor = contributorByNear.get(a.nearAccount);
            return (
              <div
                key={a.nearAccount}
                className="rounded-sm border border-border bg-muted/10 p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    to="/admin/contributors/$nearAccount"
                    params={{ nearAccount: a.nearAccount }}
                    className="text-sm font-medium hover:underline"
                  >
                    {contributor?.name ?? a.nearAccount}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {a.role ?? "—"}
                    <span className="ml-2 font-mono">{a.nearAccount}</span>
                    {a.assignedBy && (
                      <span className="ml-2">· assigned by {a.assignedBy.name}</span>
                    )}
                  </div>
                  {(otherProjectsByContributor.get(a.nearAccount) ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(otherProjectsByContributor.get(a.nearAccount) ?? []).map((p) => (
                        <Badge key={p.slug} variant="outline">
                          {p.title}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {!readOnly && a.canRemove && (
                  <Button
                    onClick={() => removeMutation.mutate(a.nearAccount)}
                    disabled={removeMutation.isPending}
                    variant="outline"
                    size="sm"
                  >
                    remove
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <div className="rounded-sm border border-border bg-muted/10 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={nearAccount}
              onChange={(e) => setNearAccount(e.target.value.trim())}
              placeholder="builder's NEAR account"
              list={builderOptions}
              aria-label="builder's NEAR account"
              disabled={addMutation.isPending}
            />
            <datalist id={builderOptions}>
              {available.map((c) => {
                const others = otherProjectsByContributor.get(c.nearAccount) ?? [];
                const suffix =
                  others.length > 0 ? ` · also on ${others.map((p) => p.slug).join(", ")}` : "";
                return (
                  <option key={c.nearAccount} value={c.nearAccount}>
                    {c.name ?? c.nearAccount}
                    {suffix}
                  </option>
                );
              })}
            </datalist>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="role (optional)"
              disabled={addMutation.isPending}
            />
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!nearAccount || addMutation.isPending}
              size="sm"
            >
              {addMutation.isPending ? "adding..." : "assign"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Any builder can be assigned by NEAR account. Profiles are shared across Agencies; add a
            missing one on{" "}
            <Link to="/admin/contributors" className="underline">
              the builders page
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
