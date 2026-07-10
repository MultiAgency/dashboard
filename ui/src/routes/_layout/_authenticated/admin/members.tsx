import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, DataTable, Spinner } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Input } from "@/components/ui/input";
import { useAuthClient } from "@/lib/auth";

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
  role: "admin" | "member" | "owner";
};

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";

function MembersPage() {
  const authClient = useAuthClient();
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await authClient.getSession();
      return data ?? null;
    },
  });

  const activeOrgId = sessionQuery.data?.session?.activeOrganizationId;

  const membersQuery = useQuery({
    queryKey: ["members", activeOrgId],
    queryFn: async () => {
      if (!activeOrgId) return [];
      const res = (await authClient.organization.listMembers({ query: { limit: 100 } })) as any;
      const raw = Array.isArray(res) ? res : (res?.data?.members ?? res?.members ?? []);
      return raw.map((m: any) => ({
        id: m.id,
        userId: m.userId,
        nearAccountId: m.user?.name ?? null,
        displayName: m.user?.name ?? null,
        role: m.role as "admin" | "member" | "owner",
      })) as Member[];
    },
    enabled: !!activeOrgId,
  });

  if (membersQuery.isLoading || sessionQuery.isLoading) {
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
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members", activeOrgId] });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          admin &middot; members
        </div>
        <h2 className="font-display text-3xl sm:text-4xl font-black uppercase leading-none tracking-tight">
          Members
        </h2>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Manage who has access to this organization and what role they hold. Invite members by
          email. Roles: <strong>owner</strong> (creator, full access), <strong>admin</strong> (full
          access), or <strong>member</strong> (read + write).
        </p>
      </div>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          invite member
        </div>
        <AddMemberForm
          onAdded={invalidate}
          authClient={authClient}
          orgId={activeOrgId ?? undefined}
        />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          current members ({members.length})
        </div>
        <MembersTable
          members={members}
          onChanged={invalidate}
          authClient={authClient}
          orgId={activeOrgId ?? undefined}
        />
      </section>
    </div>
  );
}

function MembersTable({
  members,
  onChanged,
  authClient,
  orgId,
}: {
  members: Member[];
  onChanged: () => void;
  authClient: any;
  orgId?: string;
}) {
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    setPendingRoles({});
  }, [members]);

  const updateMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "admin" | "member" | "owner" }) =>
      authClient.organization.updateMemberRole({ memberId, organizationId: orgId, role }),
    onSuccess: () => {
      toast.success("Role updated");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update role"),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      authClient.organization.removeMember({ memberId, organizationId: orgId }),
    onSuccess: () => {
      toast.success("Member removed");
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
          {row.original.nearAccountId ?? "\u2014"}
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
            value={pendingRoles[member.id] ?? member.role}
            onChange={(e) => {
              const newRole = e.target.value;
              setPendingRoles((prev) => ({ ...prev, [member.id]: newRole }));
              updateMutation.mutate({
                memberId: member.id,
                role: newRole as "admin" | "member" | "owner",
              });
            }}
            disabled={updateMutation.isPending || removeMutation.isPending}
            className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px]"
          >
            <option value="owner">owner</option>
            <option value="owner">owner</option>
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
            {removeMutation.isPending ? "\u2026" : "remove"}
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

function AddMemberForm({
  onAdded,
  authClient,
  orgId,
}: {
  onAdded: () => void;
  authClient: any;
  orgId?: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "owner">("member");

  const addMutation = useMutation({
    mutationFn: () =>
      authClient.organization.inviteMember({ email: email.trim(), role, organizationId: orgId }),
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
            {addMutation.isPending ? "inviting\u2026" : "invite \u2192"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
