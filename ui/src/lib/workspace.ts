import type { AuthClient } from "@/lib/auth";
import { isWorkspace } from "@/lib/org-metadata";

export async function listWorkspaces(authClient: AuthClient) {
  const res = await authClient.organization.list();
  return (res.data ?? []).filter((org) => isWorkspace(org.metadata));
}

export async function activeOrganizationId(authClient: AuthClient): Promise<string | null> {
  const { data: session, error } = await authClient.getSession({
    query: { disableCookieCache: true },
  });
  if (error) throw new Error(error.message ?? "Failed to validate session");
  if (!session?.session || !session.user) {
    throw new Error("Your session has expired. Sign in again to switch Organizations.");
  }
  return session?.session?.activeOrganizationId ?? null;
}

export async function switchWorkspace(
  authClient: AuthClient,
  organizationId: string,
): Promise<boolean> {
  const workspaces = await listWorkspaces(authClient);
  if (!workspaces.some((o) => o.id === organizationId)) return false;

  const currentId = await activeOrganizationId(authClient);
  if (currentId === organizationId) return true;

  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) return false;

  return (await activeOrganizationId(authClient)) === organizationId;
}
