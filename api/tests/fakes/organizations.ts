import type { Database } from "../../src/db";
import {
  type Organization,
  type OrganizationRole,
  type Organizations,
  type PluginContext,
  toOrganization,
} from "../../src/lib/organizations";
import { createOrganizationAccess } from "../../src/services/organization-access";
import type { OrganizationMembersStore } from "../../src/services/organization-recovery";

export type FakeOrganization = {
  id: string;
  daoAccountId?: string;
  isPersonal?: boolean;
  createdAt?: string;
};

export type FakeMember = { userId: string; organizationId: string; role: OrganizationRole };

function memberIdOf(member: FakeMember): string {
  return `${member.organizationId}:${member.userId}`;
}

export type FakeUser = { id: string; email: string };

export function inMemoryOrganizations(seed: {
  organizations: FakeOrganization[];
  members?: FakeMember[];
  users?: FakeUser[];
}) {
  const organizations = new Map<string, Organization>(
    seed.organizations.map((o) => [
      o.id,
      toOrganization({
        id: o.id,
        name: o.id,
        slug: o.id,
        metadata: { daoAccountId: o.daoAccountId, isPersonal: o.isPersonal },
        createdAt: o.createdAt ?? "2026-01-01T00:00:00.000Z",
      }),
    ]),
  );
  const members = [...(seed.members ?? [])];

  const port: Organizations = {
    activeMembership: async (context) => {
      const organizationId = context.organization?.activeOrganizationId;
      if (!context.userId || !organizationId) return null;
      const organization = organizations.get(organizationId);
      if (!organization) return null;
      const member = members.find(
        (m) => m.userId === context.userId && m.organizationId === organizationId,
      );
      return { organization, role: member?.role ?? null };
    },
    list: async () => [...organizations.values()],
    remove: async (organizationId) => {
      organizations.delete(organizationId);
    },
  };

  const users = seed.users ?? [];

  const membersStore: OrganizationMembersStore = {
    findUserId: async (emailOrId) =>
      users.find((u) => u.id === emailOrId || u.email.toLowerCase() === emailOrId.toLowerCase())
        ?.id ?? null,
    roster: async (organizationId) => {
      const organization = organizations.get(organizationId);
      if (!organization) return null;
      return {
        organization,
        members: members
          .filter((m) => m.organizationId === organizationId)
          .map((m) => ({ memberId: memberIdOf(m), userId: m.userId, role: m.role })),
      };
    },
    addOwner: async (input) => {
      if (
        members.some((m) => m.userId === input.userId && m.organizationId === input.organizationId)
      ) {
        throw new Error("already a member");
      }
      members.push({ ...input, role: "owner" });
    },
    promoteToOwner: async ({ memberId }) => {
      const member = members.find((m) => memberIdOf(m) === memberId);
      if (!member) throw new Error("member not found");
      member.role = "owner";
    },
  };

  return {
    port,
    members: membersStore,
    ids: () => [...organizations.keys()].sort(),
    roleOf: (userId: string, organizationId: string): OrganizationRole | null =>
      members.find((m) => m.userId === userId && m.organizationId === organizationId)?.role ?? null,
  };
}

export function signedIn(
  userId: string,
  activeOrganizationId: string | null,
  near?: string,
): PluginContext {
  return {
    userId,
    organization: activeOrganizationId ? { activeOrganizationId } : null,
    ...(near ? { near: { primaryAccountId: near } } : {}),
  };
}

export function inMemoryAccess(
  db: unknown,
  seed: Partial<Parameters<typeof inMemoryOrganizations>[0]> = {},
  defaultDaoAccountId?: string,
) {
  const { port } = inMemoryOrganizations({ organizations: [], ...seed });
  return createOrganizationAccess({ db: db as Database, organizations: port, defaultDaoAccountId });
}
