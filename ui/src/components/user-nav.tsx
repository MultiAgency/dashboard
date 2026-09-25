import { EnvelopeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { formatCount } from "@/lib/format-count";
import { nearProfileQueryOptions } from "@/lib/near-profile";
import { meRolesQueryOptions } from "@/lib/queries";

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
  const orgRole = roles?.orgRole ?? null;
  const hasClientSections = roles?.capabilities.hasClientSections ?? false;
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
      <div className="flex items-center gap-1 sm:gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/sign-in">Sign in</Link>
        </Button>
        <ConnectButton connect={connectMutation} />
      </div>
    );
  }

  const identifier = user.name || user.email || user.id;
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {invitationCount > 0 && (
        <Button asChild variant="ghost" size="icon-sm" className="relative">
          <Link
            to="/profile"
            hash="invitations"
            aria-label={`${invitationCount} pending invitation${invitationCount === 1 ? "" : "s"}`}
            title="Pending invitations"
          >
            <EnvelopeIcon aria-hidden />
            <Badge size="counter" className="absolute -top-1 -right-1" aria-hidden>
              {formatCount(invitationCount)}
            </Badge>
          </Link>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title={identifier}
            aria-label={`Signed in as ${identifier}`}
          >
            <Avatar size="sm">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={identifier} />}
              <AvatarFallback>{identifier.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-normal text-muted-foreground">Signed in as</span>
              <span className="truncate text-sm font-medium text-foreground">{identifier}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profile">Profile</Link>
          </DropdownMenuItem>
          {orgRole && (
            <DropdownMenuItem asChild>
              <Link to="/admin/projects">Organization dashboard</Link>
            </DropdownMenuItem>
          )}
          {orgRole && hasClientSections && (
            <DropdownMenuItem asChild>
              <Link to="/client">Agencies</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/dashboard">My work</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/notifications">Notifications</Link>
          </DropdownMenuItem>
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link to="/platform">Platform</Link>
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
          >
            {signOutMutation.isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ConnectButton({ connect }: { connect: { mutate: () => void; isPending: boolean } }) {
  const label = connect.isPending ? "Connecting…" : "Connect";
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => connect.mutate()}
      disabled={connect.isPending}
    >
      {label}
    </Button>
  );
}
