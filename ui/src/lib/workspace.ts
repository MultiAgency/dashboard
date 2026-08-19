import type { AuthClient } from "@/lib/auth";
import { isAgencyWorkspace } from "@/lib/org-metadata";

export async function listAgencyOrganizations(authClient: AuthClient) {
  const res = await authClient.organization.list();
  return (res.data ?? []).filter((org) => isAgencyWorkspace(org.metadata));
}

export async function activeOrganizationId(authClient: AuthClient): Promise<string | null> {
  const { data: session } = await authClient.getSession({ query: { disableCookieCache: true } });
  return session?.session?.activeOrganizationId ?? null;
}

/** Pick an agency org id to restore after client-org side effects. Never returns a client org id. */
export async function resolveAgencyOrgId(authClient: AuthClient): Promise<string | null> {
  const agencies = await listAgencyOrganizations(authClient);
  if (agencies.length === 0) return null;
  const currentId = await activeOrganizationId(authClient);
  return agencies.find((o) => o.id === currentId)?.id ?? agencies[0]!.id;
}

export async function switchAgencyWorkspace(
  authClient: AuthClient,
  organizationId: string,
): Promise<boolean> {
  const agencies = await listAgencyOrganizations(authClient);
  if (!agencies.some((o) => o.id === organizationId)) return false;

  const currentId = await activeOrganizationId(authClient);
  if (currentId === organizationId) return true;

  const first = await authClient.organization.setActive({ organizationId });
  if (first.error) return false;

  if ((await activeOrganizationId(authClient)) === organizationId) return true;

  const second = await authClient.organization.setActive({ organizationId });
  if (second.error) return false;

  return (await activeOrganizationId(authClient)) === organizationId;
}

/** Client org creation switches the active workspace — restore an agency for admin/API routes. Browser only. */
export async function ensureAgencyWorkspaceActive(authClient: AuthClient): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const agencies = await listAgencyOrganizations(authClient);
  if (agencies.length === 0) return null;

  const currentId = await activeOrganizationId(authClient);
  const current = agencies.find((o) => o.id === currentId);
  if (current) return current.id;

  const targetId = agencies[0]!.id;
  const ok = await switchAgencyWorkspace(authClient, targetId);
  return ok ? targetId : null;
}
