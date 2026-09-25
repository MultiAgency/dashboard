import { parseOrgMetadata } from "@/lib/org-metadata";

type OrganizationLike = { id: string; metadata?: unknown };

type Capabilities = {
  canManageMembers: boolean;
  hasAgencySections: boolean;
  hasClientSections: boolean;
};

export type OrganizationHome = "/admin" | "/dashboard" | "/client";

export function nonPersonalOrganizations<T extends OrganizationLike>(organizations: T[]): T[] {
  return organizations.filter((o) => !parseOrgMetadata(o.metadata).isPersonal);
}

export function organizationToActivate(
  activeOrganizationId: string | null,
  organizations: OrganizationLike[],
): string | null {
  const candidates = nonPersonalOrganizations(organizations);
  return (candidates.find((o) => o.id === activeOrganizationId) ?? candidates[0])?.id ?? null;
}

export function organizationHome(capabilities: Capabilities): OrganizationHome {
  if (capabilities.hasAgencySections) return "/admin";
  if (capabilities.hasClientSections) return "/client";
  return "/dashboard";
}

export function safeRedirect(target: unknown): string | null {
  if (typeof target !== "string") return null;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return null;
  return target;
}
