import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Field,
  FieldLabel,
  Skeleton,
} from "@/components";
import { AdminError } from "@/components/admin-error";
import { ChoiceSelect } from "@/components/admin-form";
import { Input } from "@/components/ui/input";
import { useLeaveOrganization } from "@/hooks/use-leave-organization";
import { type AuthClient, useAuthClient } from "@/lib/auth";
import {
  isLastOwner,
  memberDisplayName,
  ORGANIZATION_ROLES,
  type OrganizationRole,
  realEmail,
} from "@/lib/membership";

type Member = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  role: string;
};

const LAST_OWNER_HINT =
  "The only owner can't be removed or demoted. Make someone else owner first.";

type Invitation = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date | string;
};

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
      user?: { name?: string | null; email?: string | null };
    }>
  ).map((m) => ({
    id: m.id,
    userId: m.userId,
    displayName: memberDisplayName({ userId: m.userId, name: m.user?.name, email: m.user?.email }),
    email: realEmail(m.user?.email),
    role: m.role,
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
    return <TableSkeleton />;
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invite a team member</h2>
          </CardTitle>
          <CardDescription>
            Owners and admins manage members, projects and settings; members work on projects.
            Builders need no invitation: add them under{" "}
            <Link to="/admin/contributors" className="underline underline-offset-2">
              Builders
            </Link>{" "}
            and assign their NEAR account to a project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddMemberForm
            onAdded={invalidateAll}
            authClient={authClient}
            orgId={activeOrgId ?? undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pending invitations</h2>
          </CardTitle>
          <CardDescription>
            Invites sent but not yet accepted. Once accepted, the person appears under Current team.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{pendingInvitations.length}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Current team</h2>
          </CardTitle>
          <CardDescription>
            People who belong to this Organization. Change roles or remove access here.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{members.length}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <TableSkeleton />
          ) : (
            <MembersTable
              members={members}
              currentUserId={sessionQuery.data?.user?.id}
              onChanged={invalidateMembers}
              authClient={authClient}
              orgId={activeOrgId ?? undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
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
        role: ORGANIZATION_ROLES.find((r) => r === invitation.role) ?? "member",
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
      cell: ({ row }) => <span className="font-medium">{row.original.email}</span>,
    },
    {
      id: "role",
      header: "Role",
      accessorKey: "role",
      cell: ({ row }) => <Badge variant="outline">{row.original.role ?? "member"}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => {
        const status = invitationStatus(row.original);
        return <Badge variant={status === "pending" ? "outline" : "secondary"}>{status}</Badge>;
      },
    },
    {
      id: "expiresAt",
      header: "Expires",
      accessorKey: "expiresAt",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
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
              Resend
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => cancelMutation.mutate(invitation.id)}
              disabled={busy || !canAct}
            >
              Cancel
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
  currentUserId,
  onChanged,
  authClient,
  orgId,
}: {
  members: Member[];
  currentUserId?: string;
  onChanged: () => void;
  authClient: AuthClient;
  orgId?: string;
}) {
  const navigate = useNavigate();
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    setPendingRoles({});
  }, [members]);

  const updateMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: OrganizationRole }) => {
      const { error } = await authClient.organization.updateMemberRole({
        memberId,
        organizationId: orgId,
        role,
      });
      if (error) throw new Error(error.message ?? "Failed to update role");
    },
    onSuccess: () => {
      toast.success("Role updated");
      onChanged();
    },
    onError: (e: Error) => {
      setPendingRoles({});
      toast.error(e.message || "Failed to update role");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: orgId,
      });
      if (error) throw new Error(error.message ?? "Failed to remove member");
    },
    onSuccess: () => {
      toast.success("Member removed");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to remove member"),
  });

  const leaveMutation = useLeaveOrganization(() => navigate({ to: "/welcome", replace: true }));

  const busy = updateMutation.isPending || removeMutation.isPending || leaveMutation.isPending;

  const columns: ColumnDef<Member>[] = [
    {
      id: "displayName",
      header: "Name",
      accessorKey: "displayName",
      cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span>,
    },
    {
      id: "email",
      header: "Email",
      accessorKey: "email",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.email ?? "\u2014"}</span>
      ),
    },
    {
      id: "role",
      header: "Role",
      accessorKey: "role",
      cell: ({ row }) => {
        const member = row.original;
        const lastOwner = isLastOwner(members, member.id);
        return (
          <div className="w-28" title={lastOwner ? LAST_OWNER_HINT : undefined}>
            <ChoiceSelect
              size="sm"
              ariaLabel={`Role of ${member.displayName}`}
              value={pendingRoles[member.id] ?? member.role}
              onValueChange={(value) => {
                const newRole = value as OrganizationRole;
                setPendingRoles((prev) => ({ ...prev, [member.id]: newRole }));
                updateMutation.mutate({ memberId: member.id, role: newRole });
              }}
              disabled={busy || lastOwner}
              options={ORGANIZATION_ROLES.map((role) => ({ value: role, label: role }))}
            />
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => {
        const member = row.original;
        const lastOwner = isLastOwner(members, member.id);
        const isSelf = member.userId === currentUserId;
        return (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="destructive"
              title={lastOwner ? LAST_OWNER_HINT : undefined}
              onClick={() =>
                isSelf && orgId ? leaveMutation.mutate(orgId) : removeMutation.mutate(member.id)
              }
              disabled={busy || lastOwner}
            >
              {isSelf ? "Leave" : "Remove"}
            </Button>
          </div>
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
  const [role, setRole] = useState<OrganizationRole>("member");

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.inviteMember({
        email: email.trim(),
        role,
        organizationId: orgId,
      });
      if (error) throw new Error(error.message ?? "Failed to invite member");
    },
    onSuccess: () => {
      toast.success(`Invited ${email}`);
      setEmail("");
      onAdded();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to invite member"),
  });

  const submit = () => {
    if (email.trim() && !addMutation.isPending) addMutation.mutate();
  };

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field className="flex-1">
        <FieldLabel htmlFor="invite-member-email">Email</FieldLabel>
        <Input
          id="invite-member-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alice@example.com"
          disabled={addMutation.isPending}
        />
      </Field>
      <Field className="sm:w-36">
        <FieldLabel htmlFor="invite-member-role">Role</FieldLabel>
        <ChoiceSelect
          id="invite-member-role"
          value={role}
          onValueChange={(value) => setRole(value as OrganizationRole)}
          disabled={addMutation.isPending}
          options={ORGANIZATION_ROLES.map((option) => ({ value: option, label: option }))}
        />
      </Field>
      <Button type="submit" disabled={!email.trim() || addMutation.isPending}>
        <PaperPlaneTiltIcon data-icon="inline-start" aria-hidden />
        {addMutation.isPending ? "Inviting\u2026" : "Send invite"}
      </Button>
    </form>
  );
}
