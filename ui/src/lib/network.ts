import type { AuthClient } from "./auth";

type Network = "mainnet" | "testnet";

let _authClient: AuthClient | null = null;

export function setAuthClient(client: AuthClient): void {
  _authClient = client;
}

function authClient(): AuthClient {
  if (!_authClient) throw new Error("AuthClient not initialized — call setAuthClient first.");
  return _authClient;
}

export function getNetwork(): Network {
  return authClient().near.getNetwork();
}

export async function setNetwork(network: Network): Promise<void> {
  if (typeof window === "undefined") return;
  if (getNetwork() === network) return;
  authClient().near.setNetwork(network);
  window.location.reload();
}
