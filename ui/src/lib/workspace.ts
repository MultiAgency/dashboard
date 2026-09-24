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

export async function switchWorkspace(
  authClient: AuthClient,
  organizationId: string,
): Promise<boolean> {
  const result = await authClient.organization.setActive({ organizationId });
  if (result.error) return false;
  const { data: session } = await authClient.getSession({ query: { disableCookieCache: true } });
  return session?.session?.activeOrganizationId === organizationId;
}
