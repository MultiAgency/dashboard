import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, DataTable, Spinner } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Input } from "@/components/ui/input";
import { useApiClient } from "@/lib/api";

export const Route = createFileRoute("/_layout/_authenticated/admin/members")({
  head: () => ({
    meta: [{ title: "Members | Admin" }],
  }),
  component: MembersPage,
});

type Member = {
  id: string;
  userId: string;
  nearAccountId: string | null;
  displayName: string | null;
  role: string;
};

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";

function MembersPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const membersQuery = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.members.list(),
  });

  if (membersQuery.isLoading) {
    return (
      <section className="space-y-6">
        <Spinner />
      </section>
    );
  }

  if (membersQuery.isError) {
    return <AdminError error={membersQuery.error} />;
  }

  const members = membersQuery.data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members"] });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin · members
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Members
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Manage who has access to this organization and what role they hold. Invite members by
          email. Roles: <strong>admin</strong> (full access) or <strong>member</strong> (read + write).
        </p>
      </div>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          invite member
        </div>
        <AddMemberForm onAdded={invalidate} />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          current members ({members.length})
        </div>
        <MembersTable members={members} onChanged={invalidate} />
      </section>
    </div>
  );
}

function MembersTable({ members, onChanged }: { members: Member[]; onChanged: () => void }) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "admin" | "member" }) =>
      apiClient.members.updateRole({ memberId, role }),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => apiClient.members.remove({ memberId }),
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove member"),
  });

  const columns: ColumnDef<Member>[] = [
    {
      id: "displayName",
      header: "Name",
      accessorKey: "displayName",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.displayName ?? row.original.nearAccountId ?? row.original.userId}
        </span>
      ),
    },
    {
      id: "nearAccountId",
      header: "NEAR Account",
      accessorKey: "nearAccountId",
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.original.nearAccountId ?? "—"}
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      accessorKey: "role",
      cell: ({ row }) => {
        const member = row.original;
        return (
          <select
            value={member.role}
            onChange={(e) =>
              updateMutation.mutate({
                memberId: member.id,
                role: e.target.value as "admin" | "member",
              })
            }
            disabled={updateMutation.isPending || removeMutation.isPending}
            className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px]"
          >
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const member = row.original;
        return (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => removeMutation.mutate(member.id)}
            disabled={removeMutation.isPending || updateMutation.isPending}
          >
            {removeMutation.isPending ? "…" : "remove"}
          </Button>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={members}
      emptyMessage="No members yet."
      csvFilename="members"
    />
  );
}

function AddMemberForm({ onAdded }: { onAdded: () => void }) {
  const apiClient = useApiClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const addMutation = useMutation({
    mutationFn: () => apiClient.members.invite({ email: email.trim(), role }),
    onSuccess: () => {
      toast.success(`Invited ${email}`);
      setEmail("");
      onAdded();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to invite member"),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="invite-member-email" className={LABEL_CLS}>
              email
            </label>
            <Input
              id="invite-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
              disabled={addMutation.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim()) addMutation.mutate();
              }}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="invite-member-role" className={LABEL_CLS}>
              role
            </label>
            <select
              id="invite-member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              disabled={addMutation.isPending}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 font-mono text-xs"
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
            </select>
          </div>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!email.trim() || addMutation.isPending}
            size="sm"
          >
            {addMutation.isPending ? "inviting…" : "invite →"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
