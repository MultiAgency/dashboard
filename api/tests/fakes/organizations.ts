import type { Database } from "../../src/db";
import { organizationDaos } from "../../src/db/schema";
import {
  deliverableEmail,
  type Invitation,
  MANAGER_ROLES,
  type Organization,
  type OrganizationDirectory,
  type OrganizationRole,
  type Organizations,
  type PluginContext,
  SlugTakenError,
  toOrganization,
} from "../../src/lib/organizations";
import { createOrganizationAccess } from "../../src/services/organization-access";
import type { OrganizationMembersStore } from "../../src/services/organization-recovery";
import {
  createProjectDirectory,
  type ProjectDirectory,
} from "../../src/services/project-directory";
import { inMemoryProjects } from "./projects";

export type FakeOrganization = {
  id: string;
  name?: string;
  slug?: string;
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
        name: o.name ?? o.id,
        slug: o.slug ?? o.id,
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

  const invitations = new Map<string, Invitation & { inviterId: string }>();
  let created = 0;

  const directory: OrganizationDirectory = {
    get: async (organizationId) => organizations.get(organizationId) ?? null,
    findBySlug: async (slug) =>
      [...organizations.values()].find((o) => o.slug.toLowerCase() === slug.toLowerCase()) ?? null,
    managers: async (organizationId) =>
      members
        .filter((m) => m.organizationId === organizationId && MANAGER_ROLES.includes(m.role))
        .map((m) => ({
          userId: m.userId,
          role: m.role,
          email: deliverableEmail(users.find((u) => u.id === m.userId)?.email),
        })),
    member: async (organizationId, userId) => {
      const found = members.find((m) => m.organizationId === organizationId && m.userId === userId);
      return found
        ? {
            userId,
            role: found.role,
            email: deliverableEmail(users.find((u) => u.id === userId)?.email),
          }
        : null;
    },
    memberships: async (userId) =>
      members.flatMap((m) => {
        const organization = organizations.get(m.organizationId);
        return m.userId === userId && organization ? [{ organization, role: m.role }] : [];
      }),
    create: async ({ name, slug }) => {
      if ([...organizations.values()].some((o) => o.slug === slug)) throw new SlugTakenError(slug);
      created += 1;
      const organization = toOrganization({ id: `created-org-${created}`, name, slug });
      organizations.set(organization.id, organization);
      return organization;
    },
    invite: async (input) => {
      const invitation = {
        id: `invitation-${invitations.size + 1}`,
        organizationId: input.organizationId,
        email: input.email.toLowerCase(),
        role: input.role,
        status: "pending" as const,
        expiresAt: input.expiresAt,
        inviterId: input.inviterId,
      };
      invitations.set(invitation.id, invitation);
      return invitation;
    },
    invitation: async (invitationId) => invitations.get(invitationId) ?? null,
    updateInvitation: async (invitationId, patch) => {
      const invitation = invitations.get(invitationId);
      if (!invitation) return;
      if (patch.status) invitation.status = patch.status;
      if (patch.expiresAt) invitation.expiresAt = patch.expiresAt;
    },
  };

  return {
    port,
    directory,
    acceptInvitation: (invitationId: string, userId: string) => {
      const invitation = invitations.get(invitationId);
      if (!invitation || invitation.status !== "pending") throw new Error("invitation not found");
      invitation.status = "accepted";
      members.push({
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role ?? "member",
      });
    },
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
  directory: ProjectDirectory = createProjectDirectory(() => inMemoryProjects([]).client),
) {
  const { port } = inMemoryOrganizations({ organizations: [], ...seed });
  return createOrganizationAccess({
    db: db as Database,
    organizations: port,
    directory,
    defaultDaoAccountId,
  });
}

export async function seedAgencyDaos(db: Database, organizations: FakeOrganization[]) {
  const rows = organizations.flatMap((o) =>
    o.daoAccountId && !o.isPersonal ? [{ organizationId: o.id, daoAccountId: o.daoAccountId }] : [],
  );
  if (rows.length > 0) await db.insert(organizationDaos).values(rows).onConflictDoNothing();
}
