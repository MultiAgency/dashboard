import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuthClient } from "@/app";
import { userInvitationsQueryOptions } from "@/lib/invitations";

export function InvitationNotice() {
  const authClient = useAuthClient();
  const { data: invitations } = useQuery({
    ...userInvitationsQueryOptions(authClient),
    refetchOnWindowFocus: "always",
  });
  const count = invitations?.length ?? 0;
  if (count === 0) return null;

  return (
    <div className="border-b border-border bg-accent/30 px-4 py-2 text-sm sm:px-6">
      <Link to="/profile" hash="invitations" className="underline underline-offset-2">
        You have {count} pending Organization {count === 1 ? "invitation" : "invitations"}. View
        invites →
      </Link>
    </div>
  );
}
