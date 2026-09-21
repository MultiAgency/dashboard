import type { Organizations } from "../../src/lib/organization-access";

export type FakeOrganization = {
  id: string;
  name?: string;
  daoAccountId?: string | null;
  members?: Record<string, "owner" | "admin" | "member" | "contributor">;
};

export function inMemoryOrganizations(seed: FakeOrganization[] = []) {
  const orgs = new Map(seed.map((o) => [o.id, { members: {}, ...o }]));
  const invitations: Array<{ organizationId: string; email: string; role: string }> = [];

  const organizations: Organizations = {
    daoOf: async (organizationId) => orgs.get(organizationId)?.daoAccountId ?? null,
  };

  return { organizations, orgs, invitations };
}

export function memberContext(
  org: FakeOrganization,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    userId,
    organization: {
      activeOrganizationId: org.id,
      organization: {
        id: org.id,
        name: org.name ?? org.id,
        slug: org.id,
        metadata: org.daoAccountId ? { daoAccountId: org.daoAccountId } : {},
      },
      member: { role: org.members?.[userId] ?? null },
    },
    ...extra,
  };
}
