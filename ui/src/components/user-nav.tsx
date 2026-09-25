import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useAuthClient } from "@/app";
import { usePendingInvitations } from "@/components/pending-invitations";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNearSignIn } from "@/hooks/use-near-sign-in";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { nearProfileQueryOptions } from "@/lib/near-profile";
import { clientLookupQueryOptions, meRolesQueryOptions } from "@/lib/queries";

export function UserNav() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authClient = useAuthClient();
  const apiClient = useApiClient();

  const { data: session } = useQuery({
    ...sessionQueryOptions(authClient),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();
  const { data: profile } = useQuery(nearProfileQueryOptions(authClient, nearAccountId));
  const { data: roles } = useQuery({ ...meRolesQueryOptions(apiClient), enabled: !!user });
  const { data: clientLookup } = useQuery({
    ...clientLookupQueryOptions(apiClient, nearAccountId ?? ""),
    enabled: !!user && !!nearAccountId,
  });
  const orgRole = roles?.orgRole ?? null;
  const isSuperAdmin = session?.user?.role === "admin";
  const avatarUrl =
    profile?.image?.url ??
    (profile?.image?.ipfs_cid ? `https://ipfs.io/ipfs/${profile.image.ipfs_cid}` : null);

  const connectMutation = useNearSignIn(() => navigate({ to: "/treasury" }));
  const invitationsQuery = usePendingInvitations();
  const invitationCount = invitationsQuery.data?.length ?? 0;

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message || "Failed to sign out");
      await authClient.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      queryClient.clear();
      navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => {
      console.error("Sign out error:", error);
    },
  });

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" className="px-3 py-1.5 text-xs font-medium rounded-md">
          <Link to="/sign-in">sign in</Link>
        </Button>
        <ConnectButton connect={connectMutation} />
      </div>
    );
  }

  const identifier = user.name || user.email || user.id;
  return (
    <div className="flex items-center gap-2">
      {invitationCount > 0 && (
        <Link
          to="/profile"
          hash="invitations"
          aria-label={`${invitationCount} pending invitation${invitationCount === 1 ? "" : "s"}`}
          title="pending invitations"
          className="flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Mail className="size-4" />
          <Badge variant="accent" className="px-1.5 py-0 font-mono text-[10px]">
            {invitationCount}
          </Badge>
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="cursor-pointer rounded-sm hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title={identifier}
            aria-label={`Signed in as ${identifier}`}
          >
            <Avatar className="size-8 rounded-full ring-1 ring-accent/60">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={identifier} />}
              <AvatarFallback className="bg-muted text-foreground border-0 text-xs font-medium">
                {identifier.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">signed in as</p>
              <p className="truncate text-sm font-medium">{identifier}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profile" className="font-mono text-xs uppercase tracking-wide">
              profile
            </Link>
          </DropdownMenuItem>
          {(orgRole === "admin" || orgRole === "member" || orgRole === "owner") && (
            <DropdownMenuItem asChild>
              <Link to="/admin/projects" className="font-mono text-xs uppercase tracking-wide">
                agency dashboard
              </Link>
            </DropdownMenuItem>
          )}
          {clientLookup && clientLookup.memberships.length > 0 && (
            <DropdownMenuItem asChild>
              <Link to="/client" className="font-mono text-xs uppercase tracking-wide">
                client portal
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/platform" className="font-mono text-xs uppercase tracking-wide">
                platform
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              signOutMutation.mutate();
            }}
            disabled={signOutMutation.isPending}
            className="font-mono text-xs uppercase tracking-wide"
          >
            {signOutMutation.isPending ? "signing out..." : "sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ConnectButton({ connect }: { connect: { mutate: () => void; isPending: boolean } }) {
  const label = connect.isPending ? "connecting..." : "connect";
  return (
    <Button
      variant="outline"
      className="px-3 py-1.5 text-xs font-medium rounded-md"
      onClick={() => connect.mutate()}
      disabled={connect.isPending}
    >
      {label}
    </Button>
  );
}
