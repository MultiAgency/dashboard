export type OrganizationRole = "owner" | "admin" | "member" | "contributor";

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "contributor",
];

export type PluginContext = {
  userId?: string | null;
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

export type OrgMetadata = {
  daoAccountId?: string;
  type?: "agency" | "client";
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
