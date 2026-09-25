export type OrganizationRole = "owner" | "admin" | "member" | "contributor";

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "contributor",
];

export type PluginContext = {
  userId?: string | null;
  reqHeaders?: Headers;
  near?: {
    primaryAccountId?: string | null;
    linkedAccounts?: Array<{ accountId: string }> | null;
  } | null;
  organization?: {
    activeOrganizationId?: string | null;
    organization?: {
      id?: string;
      name?: string;
      slug?: string;
      metadata?: unknown;
    } | null;
    member?: { role?: string | null } | null;
  } | null;
};

export function nearAccountsOf(context: PluginContext): string[] {
  return [
    ...new Set([
      ...(context.near?.primaryAccountId ? [context.near.primaryAccountId] : []),
      ...(context.near?.linkedAccounts ?? []).map((a) => a.accountId),
    ]),
  ];
}

export type OrgMetadata = {
  daoAccountId?: string;
  isPersonal?: boolean;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  metadataDaoAccountId: string | null;
  createdAt: Date | null;
};

export type Membership = {
  organization: Organization;
  role: OrganizationRole | null;
};

export type Organizations = {
  activeMembership(context: PluginContext): Promise<Membership | null>;
  list(): Promise<Organization[]>;
  remove(organizationId: string): Promise<void>;
};

export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole | null;
  status: InvitationStatus;
  expiresAt: Date;
};

export type OrganizationManager = {
  userId: string;
  role: OrganizationRole;
  email: string | null;
};

export type UserMembership = {
  organization: Organization;
  role: OrganizationRole | null;
};

export type OrganizationDirectory = {
  get(organizationId: string): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  managers(organizationId: string): Promise<OrganizationManager[]>;
  memberships(userId: string): Promise<UserMembership[]>;
  create(input: { name: string; slug: string }): Promise<Organization>;
  invite(input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    inviterId: string;
    expiresAt: Date;
  }): Promise<Invitation>;
  invitation(invitationId: string): Promise<Invitation | null>;
  updateInvitation(
    invitationId: string,
    patch: { status?: InvitationStatus; expiresAt?: Date },
  ): Promise<void>;
};

export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The slug "${slug}" is already taken`);
    this.name = "SlugTakenError";
  }
}

export const MANAGER_ROLES: readonly OrganizationRole[] = ["owner", "admin"];

const WALLET_EMAIL_DOMAIN = "@near.email";
const TEMPORARY_EMAIL = /^temp-[0-9a-f]{8}@/i;

export function deliverableEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  if (!trimmed?.includes("@")) return null;
  if (trimmed.toLowerCase().endsWith(WALLET_EMAIL_DOMAIN) || TEMPORARY_EMAIL.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function toInvitationStatus(raw: string | null | undefined): InvitationStatus {
  return raw === "accepted" || raw === "rejected" || raw === "canceled" ? raw : "pending";
}

export function parseOrgMetadata(raw: unknown): OrgMetadata {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OrgMetadata;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as OrgMetadata;
  return {};
}

export function toOrganizationRole(raw: string | null | undefined): OrganizationRole | null {
  return raw && (ORGANIZATION_ROLES as readonly string[]).includes(raw)
    ? (raw as OrganizationRole)
    : null;
}

export function toOrganization(raw: {
  id: string;
  name?: string | null;
  slug?: string | null;
  metadata?: unknown;
  createdAt?: Date | string | null;
}): Organization {
  const metadata = parseOrgMetadata(raw.metadata);
  const dao = typeof metadata.daoAccountId === "string" ? metadata.daoAccountId.trim() : "";
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    slug: raw.slug ?? raw.id,
    isPersonal: metadata.isPersonal === true,
    metadataDaoAccountId: dao.length > 0 ? dao : null,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : null,
  };
}

export type BetterAuthOrganizationsClient = {
  listOrganizations(): Promise<
    Array<{ id: string; name: string; slug: string; metadata: unknown; createdAt: Date | string }>
  >;
  deleteOrganization(input: { organizationId: string }): Promise<unknown>;
};

export function betterAuthOrganizations(
  client: () => BetterAuthOrganizationsClient,
): Organizations {
  return {
    activeMembership: async (context) => {
      const active = context.organization;
      const id = active?.activeOrganizationId ?? active?.organization?.id;
      if (!context.userId || !id || !active?.organization) return null;
      return {
        organization: toOrganization({ ...active.organization, id }),
        role: toOrganizationRole(active.member?.role),
      };
    },
    list: async () => (await client().listOrganizations()).map(toOrganization),
    remove: async (organizationId) => {
      await client().deleteOrganization({ organizationId });
    },
  };
}

export function unconfiguredDirectory(): OrganizationDirectory {
  const unavailable = async (): Promise<never> => {
    throw new Error(
      "AUTH_DATABASE_URL is not configured for the API, so Organizations outside the caller's session cannot be read or created.",
    );
  };
  return {
    get: async () => null,
    findBySlug: async () => null,
    managers: async () => [],
    memberships: async () => [],
    create: unavailable,
    invite: unavailable,
    invitation: async () => null,
    updateInvitation: unavailable,
  };
}
