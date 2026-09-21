import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuthClient } from "@/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiClient } from "@/lib/api";
import { sessionQueryOptions } from "@/lib/auth";
import { nearProfileQueryOptions } from "@/lib/near-profile";
import { engagementsListQueryOptions, meRolesQueryOptions } from "@/lib/queries";

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
  const { data: engagements } = useQuery({
    ...engagementsListQueryOptions(apiClient),
    enabled: !!user && !!roles?.orgRole,
  });
  const hasAgencies = (engagements?.data ?? []).some(
    (e) => e.role === "client" && (e.status === "active" || e.status === "ended"),
  );
  const orgRole = roles?.orgRole ?? null;
  const isSuperAdmin = session?.user?.role === "admin";
  const avatarUrl =
    profile?.image?.url ??
    (profile?.image?.ipfs_cid ? `https://ipfs.io/ipfs/${profile.image.ipfs_cid}` : null);

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
      <Button asChild variant="outline" className="px-3 py-1.5 text-xs font-medium rounded-md">
        <Link to="/login">sign in</Link>
      </Button>
    );
  }

  const identifier = user.name || user.email || user.id;
  return (
    <div className="flex items-center gap-2">
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
          {hasAgencies && (
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
