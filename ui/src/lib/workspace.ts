import type { AuthClient, SessionData } from "@/lib/auth";

export type WorkspaceOrganization = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member" | null;
};

export function activeWorkspace(
  organizations: WorkspaceOrganization[],
  activeOrganizationId: string | null,
): WorkspaceOrganization | null {
  return organizations.find((o) => o.id === activeOrganizationId) ?? null;
}

export function recoveryTarget(
  organizations: WorkspaceOrganization[],
  activeOrganizationId: string | null,
): string | null {
  if (organizations.length === 0) return null;
  if (activeWorkspace(organizations, activeOrganizationId)) return null;
  return organizations[0]!.id;
}

// The server keeps one active Organization per session, and every tab of this browser shares it.
const WORKSPACE_CHANNEL = "workspace";

export function announceWorkspace(organizationId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
  channel.postMessage(organizationId);
  channel.close();
}

export function onWorkspaceChange(changed: () => void): () => void {
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(WORKSPACE_CHANNEL);
  const onVisible = () => {
    if (document.visibilityState === "visible") changed();
  };
  channel?.addEventListener("message", changed);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    channel?.close();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export async function freshSession(authClient: AuthClient): Promise<SessionData | null> {
  const { data } = await authClient.getSession({ query: { disableCookieCache: true } });
  return data ?? null;
}

export async function switchWorkspace(
  authClient: AuthClient,
  organizationId: string,
): Promise<SessionData | null> {
  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) return null;
  const session = await freshSession(authClient);
  return session?.session?.activeOrganizationId === organizationId ? session : null;
}
