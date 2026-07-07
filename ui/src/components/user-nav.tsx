import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { sessionQueryKey, sessionQueryOptions } from "@/lib/auth";
import { getNetwork, setNetwork } from "@/lib/network";
import { meRolesQueryKey, meRolesQueryOptions } from "@/lib/queries";

type Network = "mainnet" | "testnet";

type NearProfile = {
  name?: string;
  description?: string;
  image?: { url?: string; ipfs_cid?: string };
};

class NetworkMismatchError extends Error {
  readonly account: string;
  readonly walletNetwork: Network;
  readonly dashboardNetwork: Network;
  constructor(account: string, walletNetwork: Network, dashboardNetwork: Network) {
    super(`Wallet ${account} is on ${walletNetwork}, dashboard is on ${dashboardNetwork}`);
    this.name = "NetworkMismatchError";
    this.account = account;
    this.walletNetwork = walletNetwork;
    this.dashboardNetwork = dashboardNetwork;
  }
}

function networkOf(accountId: string): Network {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

// Wait for the session to be committed after signIn.near(), then return the linked NEAR account.
// better-near-auth's signIn promise resolves before the session cookie is always readable —
// this loop absorbs the lag. Uses near.getAccountId() so we get the actual NEAR account ID
// (e.g. "alice.near") rather than user.name (display name) or user.id (UUID).
async function readFreshSessionAccount(
  authClient: ReturnType<typeof useAuthClient>,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data } = await authClient.getSession();
    if (data?.user?.id) {
      const nearAccountId = authClient.near.getAccountId();
      if (nearAccountId) return nearAccountId;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export function UserNav() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authClient = useAuthClient();
  const apiClient = useApiClient();

  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const user = session?.user;
  const nearAccountId = authClient.near.getAccountId();
  const { data: profile } = useQuery({
    queryKey: ["me", "near-profile", nearAccountId ?? null] as const,
    queryFn: async () => {
      const res = await authClient.near.getProfile();
      return (res?.data ?? null) as NearProfile | null;
    },
    enabled: !!nearAccountId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: roles } = useQuery({ ...meRolesQueryOptions(apiClient), enabled: !!user });
  const orgRole = roles?.orgRole ?? null;
  const isSuperAdmin = session?.user?.role === "admin";
  const avatarUrl =
    profile?.image?.url ??
    (profile?.image?.ipfs_cid ? `https://ipfs.io/ipfs/${profile.image.ipfs_cid}` : null);

  const connectMutation = useMutation({
    mutationFn: async () => {
      await authClient.signIn.near();
      // better-near-auth doesn't validate that the wallet's account network matches the
      // recipient's. A testnet-account sign-in into a mainnet-bound dashboard lands a
      // session that 403s on every admin call. Catch it here and surface a recoverable error.
      // Refetch session with a short retry to defend against any cookie-commit window.
      const account = await readFreshSessionAccount(authClient);
      if (!account) {
        throw new Error(
          "Sign-in completed but no NEAR account was found on the session. Try again — if the issue persists, check that the auth server is running and your wallet is connected.",
        );
      }
      const dashboardNetwork = getNetwork();
      const walletNetwork = networkOf(account);
      if (walletNetwork !== dashboardNetwork) {
        // Swallow signOut failures — the toast fires regardless, and the user's recovery click
        // hits setNetwork → full reload, which resets in-memory auth state either way.
        await authClient.signOut().catch(() => {});
        throw new NetworkMismatchError(account, walletNetwork, dashboardNetwork);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryOptions(authClient).queryKey }),
        queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
      ]);
      navigate({ to: "/treasury" });
    },
    onError: (error: Error) => {
      if (error instanceof NetworkMismatchError) {
        queryClient.setQueryData(sessionQueryKey, null);
        void queryClient.invalidateQueries({ queryKey: meRolesQueryKey });
        toast.error(
          `wallet ${error.account} is on ${error.walletNetwork} — dashboard is on ${error.dashboardNetwork}`,
          {
            action: {
              label: `switch to ${error.walletNetwork}`,
              onClick: () => {
                void setNetwork(error.walletNetwork);
              },
            },
            duration: 15_000,
          },
        );
        return;
      }
      toast.error(error.message || "Failed to connect NEAR wallet");
    },
  });

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
    return <ConnectButton connect={connectMutation} />;
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
          {(orgRole === "admin" || orgRole === "contributor") && (
            <DropdownMenuItem asChild>
              <Link to="/admin/settings" className="font-mono text-xs uppercase tracking-wide">
                settings
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link
                to="/admin/platform"
                search={{ prefillSlug: undefined, prefillDaoAccountId: undefined }}
                className="font-mono text-xs uppercase tracking-wide"
              >
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

// Pre-connect button. Tells the user which network they're about to authenticate against —
// reduces the wallet-network-mismatch toast we'd otherwise show reactively. getNetwork reads
// URL+cookie (client-only), so we render the bare label first then upgrade on mount.
function ConnectButton({ connect }: { connect: { mutate: () => void; isPending: boolean } }) {
  // Local `setNetwork` shadows the imported auth helper, intentionally — the import only fires
  // from the outer UserNav mutation, never inside this component. Keeping the natural name.
  const [network, setNetwork] = useState<Network | null>(null);
  useEffect(() => setNetwork(getNetwork()), []);
  const label = connect.isPending ? "connecting..." : network ? `connect · ${network}` : "connect";
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => connect.mutate()}
        disabled={connect.isPending}
      >
        {label}
      </Button>
    </div>
  );
}
