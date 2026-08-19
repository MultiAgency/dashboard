import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, DataTable, Spinner } from "@/components";
import { AdminError } from "@/components/admin-error";
import { Input } from "@/components/ui/input";
import { type AuthClient, useAuthClient } from "@/lib/auth";

type Member = {
  id: string;
  userId: string;
  nearAccountId: string | null;
  displayName: string | null;
  role: "admin" | "member" | "owner";
};

type Invitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date | string;
};

const LABEL_CLS = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground block";

function unwrapMembers(res: unknown): Member[] {
  const raw = Array.isArray(res)
    ? res
    : ((res as { data?: { members?: unknown[] }; members?: unknown[] })?.data?.members ??
      (res as { members?: unknown[] })?.members ??
      []);

  return (
    raw as Array<{
      id: string;
      userId: string;
      role: string;
      user?: { name?: string | null };
    }>
  ).map((m) => ({
    id: m.id,
    userId: m.userId,
    nearAccountId: m.user?.name ?? null,
    displayName: m.user?.name ?? null,
    role: m.role as Member["role"],
  }));
}

function unwrapInvitations(res: unknown): Invitation[] {
  if (Array.isArray(res)) return res as Invitation[];
  const wrapped = res as { data?: Invitation[] };
  return wrapped?.data ?? [];
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function invitationStatus(invitation: Invitation): "pending" | "expired" | string {
  if (invitation.status !== "pending") return invitation.status;
  const expires = new Date(invitation.expiresAt);
  if (!Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()) return "expired";
  return "pending";
}

export function MembersAdminSection() {
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
      const { data, error } = await authClient.organization.listMembers({ query: { limit: 100 } });
      if (error) throw new Error(error.message ?? "Failed to load members");
      return unwrapMembers(data);
    },
    enabled: !!activeOrgId,
  });

  const invitationsQuery = useQuery({
    queryKey: ["invitations", activeOrgId],
    queryFn: async () => {
      if (!activeOrgId) return [];
      const { data, error } = await authClient.organization.listInvitations({
        query: { organizationId: activeOrgId },
      });
      if (error) throw new Error(error.message ?? "Failed to load invitations");
      return unwrapInvitations(data);
    },
    enabled: !!activeOrgId,
  });

  if (sessionQuery.isLoading) {
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
  const invitations = invitationsQuery.data ?? [];
  const pendingInvitations = invitations.filter((inv) => invitationStatus(inv) === "pending");

  const invalidateMembers = () => {
    queryClient.invalidateQueries({ queryKey: ["members", activeOrgId] });
  };
  const invalidateInvitations = () => {
    queryClient.invalidateQueries({ queryKey: ["invitations", activeOrgId] });
  };
  const invalidateAll = () => {
    invalidateMembers();
    invalidateInvitations();
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          invite team member
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Email invitations join this agency workspace. Admins can manage projects, clients, and
          settings. This does not create a builder profile — add builders separately under{" "}
          <Link
            to="/admin/contributors"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Builders
          </Link>
          .
        </p>
        <AddMemberForm
          onAdded={invalidateAll}
          authClient={authClient}
          orgId={activeOrgId ?? undefined}
        />
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          pending invitations ({pendingInvitations.length})
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Invites sent but not yet accepted. Resend or cancel here; once accepted, the person
          appears in Current team below.
        </p>
        {invitationsQuery.isError ? (
          <AdminError error={invitationsQuery.error} />
        ) : (
          <PendingInvitationsTable
            invitations={pendingInvitations}
            isLoading={invitationsQuery.isLoading}
            onChanged={invalidateInvitations}
            authClient={authClient}
            orgId={activeOrgId ?? undefined}
          />
        )}
      </section>

      <section className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          current team ({members.length})
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          People who accepted an invite and belong to this workspace. Change roles or remove access
          here.
        </p>
        {membersQuery.isLoading ? (
          <Spinner />
        ) : (
          <MembersTable
            members={members}
            onChanged={invalidateMembers}
            authClient={authClient}
            orgId={activeOrgId ?? undefined}
          />
        )}
      </section>
    </div>
  );
}

function PendingInvitationsTable({
  invitations,
  isLoading,
  onChanged,
  authClient,
  orgId,
}: {
  invitations: Invitation[];
  isLoading: boolean;
  onChanged: () => void;
  authClient: AuthClient;
  orgId?: string;
}) {
  const cancelMutation = useMutation({
    mutationFn: (invitationId: string) =>
      authClient.organization.cancelInvitation({ invitationId }),
    onSuccess: () => {
      toast.success("Invitation canceled");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to cancel invitation"),
  });

  const resendMutation = useMutation({
    mutationFn: (invitation: Invitation) =>
      authClient.organization.inviteMember({
        email: invitation.email,
        role: (invitation.role ?? "member") as "admin" | "member" | "owner",
        organizationId: orgId,
        resend: true,
      }),
    onSuccess: (_data, invitation) => {
      toast.success(`Invitation resent to ${invitation.email}`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to resend invitation"),
  });

  const columns: ColumnDef<Invitation>[] = [
    {
      id: "email",
      header: "Email",
      accessorKey: "email",
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.email}</span>,
    },
    {
      id: "role",
      header: "Role",
      accessorKey: "role",
      cell: ({ row }) => (
        <span className="font-mono text-xs uppercase text-muted-foreground">
          {row.original.role ?? "member"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => {
        const status = invitationStatus(row.original);
        return (
          <Badge variant={status === "pending" ? "outline" : "secondary"} className="text-[10px]">
            {status}
          </Badge>
        );
      },
    },
    {
      id: "expiresAt",
      header: "Expires",
      accessorKey: "expiresAt",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatDate(row.original.expiresAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => {
        const invitation = row.original;
        const busy = cancelMutation.isPending || resendMutation.isPending;
        const canAct = invitationStatus(invitation) === "pending";
        return (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => resendMutation.mutate(invitation)}
              disabled={busy || !canAct}
            >
              resend
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => cancelMutation.mutate(invitation.id)}
              disabled={busy || !canAct}
            >
              cancel
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={invitations}
      isLoading={isLoading}
      emptyMessage="No pending invitations."
      csvFilename="pending-invitations"
      viewId="admin-pending-invitations"
    />
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
  authClient: AuthClient;
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
      authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId: orgId }),
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
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
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
      viewId="admin-members"
    />
  );
}

function AddMemberForm({
  onAdded,
  authClient,
  orgId,
}: {
  onAdded: () => void;
  authClient: AuthClient;
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
