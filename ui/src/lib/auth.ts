import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  adminClient,
  anonymousClient,
  inferAdditionalFields,
  organizationClient,
  phoneNumberClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import type { RelayedTransactionT } from "better-near-auth";
import { siwnClient } from "better-near-auth/client";
import type { ClientRuntimeConfig } from "everything-dev/types";
import { getRuntimeConfig } from "everything-dev/ui/runtime";
import type { Auth } from "./auth-types.gen";

function readRuntimeConfig(config?: Partial<ClientRuntimeConfig>) {
  if (config) return config;
  if (typeof window === "undefined") return undefined;
  try {
    return getRuntimeConfig();
  } catch {
    return undefined;
  }
}

function getAccountId(config?: Partial<ClientRuntimeConfig>) {
  return readRuntimeConfig(config)?.account ?? "every.near";
}

export function getNetwork(config?: Partial<ClientRuntimeConfig>): "mainnet" | "testnet" {
  if (typeof window !== "undefined") {
    // URL is canonical; localStorage is next-session memory.
    const fromUrl = new URLSearchParams(window.location.search).get("network");
    if (fromUrl === "mainnet" || fromUrl === "testnet") return fromUrl;
    const cached = window.localStorage.getItem("agency_network");
    if (cached === "mainnet" || cached === "testnet") return cached;
  }
  return (
    readRuntimeConfig(config)?.networkId ??
    (getAccountId(config).endsWith(".testnet") ? "testnet" : "mainnet")
  );
}

export async function setNetwork(network: "mainnet" | "testnet"): Promise<void> {
  if (typeof window === "undefined") return;
  if (getNetwork() === network) return;
  window.localStorage.setItem("agency_network", network);
  // URL is the authoritative source for the active network. Full reload so SSR
  // routes (loaders) re-fetch with the new network on the new HTML shell.
  const url = new URL(window.location.href);
  url.searchParams.set("network", network);
  window.location.href = url.toString();
}

function getHostUrl(config?: Partial<ClientRuntimeConfig>) {
  const runtimeConfig = readRuntimeConfig(config);
  if (runtimeConfig?.hostUrl) return runtimeConfig.hostUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function getCspNonce(config?: Partial<ClientRuntimeConfig>) {
  const runtimeConfig = readRuntimeConfig(config);
  if (runtimeConfig?.cspNonce) return runtimeConfig.cspNonce;
  if (typeof document !== "undefined") {
    return document.querySelector("script[nonce]")?.getAttribute("nonce") ?? undefined;
  }
  return undefined;
}

export function createAuthClient(config?: Partial<ClientRuntimeConfig>) {
  const nearAuthConfig = {
    recipient: getAccountId(config),
    networkId: getNetwork(config),
    cspNonce: getCspNonce(config),
  };

  return createBetterAuthClient({
    baseURL: getHostUrl(config),
    fetchOptions: { credentials: "include" },
    plugins: [
      inferAdditionalFields<Auth>(),
      siwnClient(nearAuthConfig),
      adminClient(),
      anonymousClient(),
      phoneNumberClient(),
      passkeyClient(),
      organizationClient(),
      apiKeyClient(),
    ],
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;
type OrganizationListResult = Awaited<ReturnType<AuthClient["organization"]["list"]>>;
type PasskeyListResult = Awaited<ReturnType<AuthClient["passkey"]["listUserPasskeys"]>>;

export type SessionData = AuthClient["$Infer"]["Session"];
export type Organization = NonNullable<OrganizationListResult["data"]>[number];
export type Passkey = NonNullable<PasskeyListResult["data"]>[number];

export function useAuthClient(): AuthClient {
  return useRouter().options.context.authClient;
}

export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient, initialSession?: SessionData | null) {
  const baseOptions = {
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data: session } = await authClient.getSession();
      return session ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  };

  return initialSession === undefined
    ? baseOptions
    : { ...baseOptions, initialData: initialSession };
}

export function useRelayHistory(session: SessionData | null | undefined, authClient: AuthClient) {
  return useQuery({
    queryKey: ["relay-history"],
    queryFn: async () => {
      const res = await authClient.near.relayHistory();
      return (res?.data?.transactions ?? []) as RelayedTransactionT[];
    },
    enabled: !!session,
    refetchInterval: 2000,
  });
}
