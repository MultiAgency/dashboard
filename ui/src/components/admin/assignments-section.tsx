import { UserMinusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { Empty } from "@/components/admin-form";
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

  const canAssign = !!nearAccount && !addMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Builders</h2>
        </CardTitle>
        <CardDescription>People assigned to work on this project.</CardDescription>
        <CardAction>
          <Badge variant="secondary">{assigned.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {assigned.length === 0 ? (
          <Empty icon={<UsersThreeIcon aria-hidden />} label="No builders assigned" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Builder</TableHead>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col">Also on</TableHead>
                {!readOnly && (
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assigned.map((a) => {
                const contributor = contributorByNear.get(a.nearAccount);
                const others = otherProjectsByContributor.get(a.nearAccount) ?? [];
                return (
                  <TableRow key={a.nearAccount}>
                    <TableCell>
                      <Link
                        to="/admin/contributors/$nearAccount"
                        params={{ nearAccount: a.nearAccount }}
                        className="font-medium hover:underline"
                      >
                        {contributor?.name ?? a.nearAccount}
                      </Link>
                      <span className="block text-muted-foreground">
                        {a.nearAccount}
                        {a.assignedBy && ` · assigned by ${a.assignedBy.name}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.role ?? "—"}</TableCell>
                    <TableCell>
                      {others.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {others.map((p) => (
                            <Badge key={p.slug} variant="outline">
                              {p.title}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        {a.canRemove && (
                          <div className="flex justify-end">
                            <Button
                              onClick={() => removeMutation.mutate(a.nearAccount)}
                              disabled={removeMutation.isPending}
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Unassign ${contributor?.name ?? a.nearAccount}`}
                            >
                              <UserMinusIcon aria-hidden />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {!readOnly && (
        <CardFooter>
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canAssign) addMutation.mutate();
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field className="flex-1">
                <FieldLabel htmlFor={`assign-near-${projectId}`}>NEAR account</FieldLabel>
                <Input
                  id={`assign-near-${projectId}`}
                  value={nearAccount}
                  onChange={(e) => setNearAccount(e.target.value.trim())}
                  placeholder="builder.near"
                  list={builderOptions}
                  disabled={addMutation.isPending}
                />
              </Field>
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
              <Field className="sm:w-48">
                <FieldLabel htmlFor={`assign-role-${projectId}`}>Role</FieldLabel>
                <Input
                  id={`assign-role-${projectId}`}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Optional"
                  disabled={addMutation.isPending}
                />
              </Field>
              <Button type="submit" disabled={!canAssign}>
                {addMutation.isPending ? "Assigning…" : "Assign"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Any builder can be assigned by NEAR account. Profiles are shared across Agencies; add
              a missing one on{" "}
              <Link to="/admin/contributors" className="underline underline-offset-2">
                the builders page
              </Link>
              .
            </p>
          </form>
        </CardFooter>
      )}
    </Card>
  );
}
