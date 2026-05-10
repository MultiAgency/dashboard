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
import { siwnClient } from "better-near-auth/client";
import { getAccount, getHostUrl, getNetworkId } from "@/app";
import type { Auth } from "../auth-types.gen";

export function createAuthClient() {
  return createBetterAuthClient({
    baseURL: getHostUrl(),
    fetchOptions: { credentials: "include" },
    plugins: [
      inferAdditionalFields<Auth>(),
      siwnClient({
        recipient: getAccount(),
        networkId: getNetworkId(),
      }),
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
export type SessionData = AuthClient["$Infer"]["Session"];

type UnwrapListResponse<T> = T extends (...args: any[]) => Promise<{
  data: (infer U)[] | null;
  error: any;
}>
  ? U
  : never;

export type Organization = UnwrapListResponse<AuthClient["organization"]["list"]>;
export type Passkey = UnwrapListResponse<AuthClient["passkey"]["listUserPasskeys"]>;

export function useAuthClient(): AuthClient {
  return useRouter().options.context.authClient;
}

export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient, initialSession?: SessionData | null) {
  return {
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data: session } = await authClient.getSession();
      return session ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: initialSession,
  };
}

export function getSessionFromData(session: SessionData | null) {
  const isAuthenticated = !!session?.user;
  return {
    isAuthenticated,
    user: session?.user ?? null,
    session: session?.session ?? null,
  };
}

export async function connectNear(authClient: AuthClient) {
  await authClient.signIn.near();
}

export async function signOut(authClient: AuthClient) {
  const { error } = await authClient.signOut();
  if (error) {
    throw new Error(error.message || "Failed to sign out");
  }
  await authClient.near.disconnect().catch(() => {});
}

export function useRelayHistory(authClient: AuthClient, session: any) {
  return useQuery({
    queryKey: ["relay-history"],
    queryFn: async () => {
      const res = await authClient.near.relayHistory();
      if (res.error) {
        console.error("relayHistory error:", res.error);
      }
      return res?.data?.transactions ?? [];
    },
    enabled: !!session,
    refetchInterval: 2000,
  });
}
