import type { AuthClient } from "@/lib/auth";

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

// The server keeps one active Organization per session, which every tab of this browser
// shares. One channel per tab, because a BroadcastChannel never receives its own messages.
let channel: BroadcastChannel | null = null;

function workspaceChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel("workspace");
  return channel;
}

export function announceWorkspace(organizationId: string) {
  workspaceChannel()?.postMessage(organizationId);
}

export function onWorkspaceChange(changed: () => void): () => void {
  const workspace = workspaceChannel();
  const onVisible = () => {
    if (document.visibilityState === "visible") changed();
  };
  workspace?.addEventListener("message", changed);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    workspace?.removeEventListener("message", changed);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export async function switchWorkspace(
  authClient: AuthClient,
  organizationId: string,
): Promise<boolean> {
  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) return false;
  const { data: session } = await authClient.getSession({ query: { disableCookieCache: true } });
  return session?.session?.activeOrganizationId === organizationId;
}
