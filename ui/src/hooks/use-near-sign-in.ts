import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { sessionQueryKey, sessionQueryOptions } from "@/lib/auth";
import { getNetwork, setNetwork } from "@/lib/network";
import { meRolesQueryKey } from "@/lib/queries";

type Network = "mainnet" | "testnet";

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

export function useNearSignIn(onSignedIn: () => void | Promise<void>) {
  const queryClient = useQueryClient();
  const authClient = useAuthClient();

  return useMutation({
    mutationFn: () =>
      new Promise<void>((resolve, reject) => {
        authClient.signIn.near({
          onSuccess: () => {
            const state = authClient.near.getState();
            if (!state?.accountId) {
              reject(
                new Error(
                  "Sign-in completed but the NEAR wallet did not report the linked account. Try again — if the issue persists, reconnect your wallet extension.",
                ),
              );
              return;
            }
            const dashboardNetwork = getNetwork();
            const walletNetwork = state.networkId as Network;
            if (walletNetwork !== dashboardNetwork) {
              void authClient.signOut().catch(() => {});
              reject(new NetworkMismatchError(state.accountId, walletNetwork, dashboardNetwork));
              return;
            }
            resolve();
          },
          onError: (error) => {
            reject(error);
          },
        });
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryOptions(authClient).queryKey }),
        queryClient.invalidateQueries({ queryKey: meRolesQueryKey }),
      ]);
      await onSignedIn();
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
}
