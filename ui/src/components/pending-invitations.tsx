import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button } from "@/components";
import { Empty } from "@/components/admin-form";
import { LoadingCard } from "@/components/loading-card";
import { OrganizationRowCard } from "@/components/organization-row-card";
import {
  landingDestination,
  refreshAccountQueries,
  refreshAfterAccountChange,
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
      await refreshAfterAccountChange(queryClient, authClient);
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
    return <LoadingCard label="invitations" />;
  }

  if (invitations.length === 0) {
    return <Empty label="No pending invitations." />;
  }

  return (
    <div className="grid gap-3">
      {invitations.map((invitation) => (
        <OrganizationRowCard
          key={invitation.id}
          name={invitation.organizationName}
          role={invitation.role}
          details={
            <span className="font-mono text-xs text-muted-foreground">
              expires {new Date(invitation.expiresAt).toISOString().slice(0, 10)}
            </span>
          }
        >
          <div className="flex gap-2">
            <Button size="sm" onClick={() => accept.mutate(invitation.id)} disabled={busy}>
              accept →
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => decline.mutate(invitation.id)}
              disabled={busy}
            >
              decline
            </Button>
          </div>
        </OrganizationRowCard>
      ))}
    </div>
  );
}
