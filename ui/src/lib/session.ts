import type { ClientRuntimeConfig } from "@/app";
import { getAuthClient, type SessionData } from "@/app";

export type { SessionData };

export const sessionQueryKey = ["session"] as const;

export const sessionQueryOptions = (
  initialSession?: SessionData | null,
  runtimeConfig?: Partial<ClientRuntimeConfig>,
) => ({
  queryKey: sessionQueryKey,
  queryFn: async () => {
    const { data: session } = await getAuthClient(runtimeConfig).getSession();
    return session ?? null;
  },
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
  initialData: initialSession,
});

export function getSessionFromData(session: SessionData | null) {
  const isAuthenticated = !!session?.user;
  return {
    isAuthenticated,
    user: session?.user ?? null,
    session: session?.session ?? null,
  };
}

export async function connectNear() {
  const client = getAuthClient();
  await client.near.signIn();
}

export async function signOut() {
  const client = getAuthClient();
  const { error } = await client.signOut();
  if (error) {
    throw new Error(error.message || "Failed to sign out");
  }
  await client.near.disconnect().catch(() => {});
}
