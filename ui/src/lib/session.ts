import { queryOptions } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export type SessionData = typeof authClient.$Infer.Session;
export type User = SessionData["user"];
export type SessionInfo = SessionData["session"];

export const sessionQueryOptions = (initialSession?: SessionData | null) =>
  queryOptions({
    queryKey: ["session"],
    queryFn: async () => {
      const { data: session } = await authClient.getSession();
      return session ?? null;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    initialData: initialSession,
  });

export function getSessionFromData(session: SessionData | null | undefined) {
  if (!session?.user) {
    return {
      isAuthenticated: false,
      user: null,
      session: null,
    };
  }

  return {
    isAuthenticated: true,
    user: session.user,
    session: session.session,
  };
}

export async function signOut() {
  await authClient.signOut();
  await authClient.near.disconnect().catch(() => {});
}

export function connectNear(): Promise<void> {
  return new Promise((resolve, reject) => {
    authClient.signIn.near({
      onSuccess: () => resolve(),
      onError: (error: unknown) => reject(error),
    });
  });
}
