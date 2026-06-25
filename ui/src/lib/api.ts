import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { useRouter } from "@tanstack/react-router";
import type { ApiContract } from "./api-types.gen";

export type { ApiContract };
export type ApiClient = ContractRouterClient<ApiContract>;
export type Network = "mainnet" | "testnet";

const NETWORK_HEADER = "x-network";

let browserApiClient: ApiClient | null = null;

// Read the active network from URL (canonical) → localStorage (next-session memory).
// Returns null when neither has a value; the API server's mainnet default applies.
function detectClientNetwork(): Network | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("network");
  if (fromUrl === "mainnet" || fromUrl === "testnet") return fromUrl;
  const fromStore = window.localStorage.getItem("agency_network");
  if (fromStore === "mainnet" || fromStore === "testnet") return fromStore;
  return null;
}

function createRpcLink(opts: { hostUrl: string; rpcBase: string; network: Network | null }) {
  return new RPCLink({
    url: `${opts.hostUrl}${opts.rpcBase}`,
    interceptors: [
      onError((error: unknown) => {
        console.error("oRPC API Error:", error);

        if (typeof window === "undefined") {
          return;
        }

        if (error && typeof error === "object" && "message" in error) {
          const message = String(error.message).toLowerCase();
          if (
            message.includes("fetch") ||
            message.includes("network") ||
            message.includes("failed to fetch")
          ) {
            void import("sonner").then(({ toast }) => {
              toast.error("Unable to connect to API", {
                id: "api-connection-error",
                description: "The API is currently unavailable. Please try again later.",
              });
            });
          }
        }
      }),
    ],
    fetch(url: RequestInfo | URL, options?: RequestInit) {
      // Resolve at call time: SSR uses the value provided at apiClient creation;
      // client reads URL/localStorage live so a toggle takes effect immediately
      // without recreating the client.
      const network = opts.network ?? detectClientNetwork();
      const headers = new Headers(options?.headers);
      if (network) headers.set(NETWORK_HEADER, network);
      return fetch(url, { ...options, headers, credentials: "include" });
    },
  });
}

export function createApiClient(runtimeConfig: {
  hostUrl: string;
  rpcBase: string;
  network?: Network | null;
}): ApiClient {
  if (!runtimeConfig.hostUrl) {
    throw new Error("Missing runtime host URL");
  }

  if (typeof window !== "undefined" && browserApiClient) {
    return browserApiClient;
  }

  const client: ApiClient = createORPCClient(
    createRpcLink({
      hostUrl: runtimeConfig.hostUrl,
      rpcBase: runtimeConfig.rpcBase,
      network: runtimeConfig.network ?? null,
    }),
  );

  if (typeof window !== "undefined") {
    browserApiClient = client;
  }

  return client;
}

export function useApiClient(): ApiClient {
  return useRouter().options.context.apiClient;
}
