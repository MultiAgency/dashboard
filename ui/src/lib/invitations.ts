import { queryOptions } from "@tanstack/react-query";
import type { AuthClient } from "@/lib/auth";

export const userInvitationsQueryKey = ["invitations", "mine"] as const;

export function userInvitationsQueryOptions(authClient: AuthClient) {
  return queryOptions({
    queryKey: userInvitationsQueryKey,
    queryFn: async () => {
      const { data, error } = await authClient.organization.listUserInvitations();
      if (error) throw new Error(error.message || "Could not load invitations");
      return (data ?? []).filter((invitation) => new Date(invitation.expiresAt) > new Date());
    },
    staleTime: 30_000,
    retry: false,
  });
}
