import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent } from "@/components";
import { Empty } from "@/components/admin-form";
import {
  landingDestination,
  refreshAccountQueries,
  type UserInvitation,
  userInvitationsQueryOptions,
} from "@/lib/account";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";

export function useInvitationActions() {
  const authClient = useAuthClient();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const accept = useMutation({
    mutationFn: async (invitationId: string) => {
      const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
      if (error) throw new Error(error.message ?? "Could not accept the invitation");
      const organizationId = data?.invitation.organizationId;
      if (organizationId) {
        const { error: activeError } = await authClient.organization.setActive({
          organizationId,
        });
        if (activeError) throw new Error(activeError.message ?? "Could not open the Organization");
      }
      await refreshAccountQueries(queryClient);
      return landingDestination({ authClient, apiClient, queryClient });
    },
    onSuccess: (destination) => {
      toast.success("Invitation accepted");
      navigate({ to: destination, replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await authClient.organization.rejectInvitation({ invitationId });
      if (error) throw new Error(error.message ?? "Could not decline the invitation");
      await refreshAccountQueries(queryClient);
    },
    onSuccess: () => toast.success("Invitation declined"),
    onError: (e: Error) => toast.error(e.message),
  });

  return { accept, decline, busy: accept.isPending || decline.isPending };
}

export function usePendingInvitations() {
  const authClient = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  return useQuery(userInvitationsQueryOptions(authClient, !!session?.user));
}

export function PendingInvitationsList() {
  const invitationsQuery = usePendingInvitations();
  const { accept, decline, busy } = useInvitationActions();
  const invitations = invitationsQuery.data ?? [];

  if (invitationsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
          loading invitations...
        </CardContent>
      </Card>
    );
  }

  if (invitations.length === 0) {
    return <Empty label="No pending invitations." />;
  }

  return (
    <div className="grid gap-3">
      {invitations.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          invitation={invitation}
          busy={busy}
          onAccept={() => accept.mutate(invitation.id)}
          onDecline={() => decline.mutate(invitation.id)}
        />
      ))}
    </div>
  );
}

function InvitationRow({
  invitation,
  busy,
  onAccept,
  onDecline,
}: {
  invitation: UserInvitation;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 min-w-0">
          <div className="font-display text-xl uppercase tracking-tight font-extrabold leading-tight break-words">
            {invitation.organizationName}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {invitation.role ?? "member"}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              expires {new Date(invitation.expiresAt).toISOString().slice(0, 10)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onAccept} disabled={busy}>
            accept →
          </Button>
          <Button size="sm" variant="outline" onClick={onDecline} disabled={busy}>
            decline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
