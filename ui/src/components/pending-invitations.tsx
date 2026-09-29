import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { LoadingCard } from "@/components/loading-card";
import { OrganizationRowCard } from "@/components/organization-row-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
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

export function PendingInvitationsList({
  emptyDescription = "Invitations sent to your email show up here.",
}: {
  emptyDescription?: ReactNode;
}) {
  const invitationsQuery = usePendingInvitations();
  const { accept, decline, busy } = useInvitationActions();
  const invitations = invitationsQuery.data ?? [];

  if (invitationsQuery.isLoading) {
    return <LoadingCard label="invitations" rows={1} />;
  }

  if (invitations.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EnvelopeSimpleIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No pending invitations</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ItemGroup>
      {invitations.map((invitation) => (
        <OrganizationRowCard
          key={invitation.id}
          name={invitation.organizationName}
          role={invitation.role}
          details={<span>Expires {formatDate(invitation.expiresAt)}</span>}
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => decline.mutate(invitation.id)}
            disabled={busy}
          >
            Decline
          </Button>
          <Button size="sm" onClick={() => accept.mutate(invitation.id)} disabled={busy}>
            {accept.isPending && accept.variables === invitation.id && (
              <Spinner data-icon="inline-start" />
            )}
            Accept
          </Button>
        </OrganizationRowCard>
      ))}
    </ItemGroup>
  );
}

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
