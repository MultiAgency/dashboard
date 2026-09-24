import { desc, eq, inArray, or } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { DecoratedMiddleware } from "every-plugin/orpc";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Client, clientProjects, clients, organizationDaos } from "../db/schema";
import type { AuthContext } from "../lib/auth";
import type { Network } from "../lib/network";
import type {
  Organization,
  OrganizationRole,
  Organizations,
  PluginContext,
} from "../lib/organizations";
import type { ProjectDirectory } from "./project-directory";

export type AgencyScope = {
  organizationId: string | null;
  agencyDao: string;
  network: Network;
  role: OrganizationRole | null;
  actorId: string;
  canSeePrivate: boolean;
  pluginContext: PluginContext;
};

export const ROLE_MATRIX = {
  work: ["owner", "admin", "member"],
  manage: ["owner", "admin"],
  seePrivate: ["owner", "admin", "contributor"],
} as const satisfies Record<string, readonly OrganizationRole[]>;

export type Capabilities = {
  canManageMembers: boolean;
  canUseMoney: boolean;
  hasAgencySections: boolean;
  hasClientSections: boolean;
};

export type Engagement = {
  id: string;
  agencyOrganizationId: string;
  clientOrganizationId: string;
  kind: "client" | "subcontract";
  status: "proposed" | "active" | "declined" | "ended";
};

export type Engagements = { asAgency: Engagement[]; asClient: Engagement[] };

export type ProjectRelation = "owned" | "client" | "subcontractor";

export type OrganizationAccess = {
  organization: Organization | null;
  role: OrganizationRole | null;
  agencyDao: string | null;
  actorId: string;
  capabilities: Capabilities;
  pluginContext: PluginContext;
};

export type ClientMembership = { client: Client; projectIds: string[] };

const NO_ENGAGEMENTS: Engagements = { asAgency: [], asClient: [] };

function hasRole(roles: readonly OrganizationRole[], role: OrganizationRole | null): boolean {
  return role !== null && roles.includes(role);
}

function networkOf(agencyDao: string): Network {
  return agencyDao.endsWith(".testnet") ? "testnet" : "mainnet";
}

function actorOf(context: PluginContext): string {
  return context.near?.primaryAccountId ?? context.userId ?? "unknown";
}

function forbidden(message: string, data?: Record<string, unknown>) {
  return new ORPCError("FORBIDDEN", { message, data });
}

export function createOrganizationAccess(deps: {
  db: Database;
  organizations: Organizations;
  directory: ProjectDirectory;
  defaultDaoAccountId?: string;
}) {
  const { db, organizations, directory, defaultDaoAccountId } = deps;

  async function agencyDaoOf(organization: Organization): Promise<string | null> {
    if (organization.isPersonal) return null;
    const claimed = organization.metadataDaoAccountId;
    const rows = await db
      .select()
      .from(organizationDaos)
      .where(
        claimed
          ? or(
              eq(organizationDaos.organizationId, organization.id),
              eq(organizationDaos.daoAccountId, claimed),
            )
          : eq(organizationDaos.organizationId, organization.id),
      );
    const mapped = rows.find((row) => row.organizationId === organization.id);
    if (mapped) return mapped.daoAccountId;
    return claimed && rows.length === 0 ? claimed : null;
  }

  async function resolve(context: PluginContext): Promise<OrganizationAccess> {
    const membership = context.userId ? await organizations.activeMembership(context) : null;
    const organization = membership?.organization ?? null;
    const role = organization && !organization.isPersonal ? (membership?.role ?? null) : null;
    const agencyDao = organization ? await agencyDaoOf(organization) : null;
    const engagements = NO_ENGAGEMENTS;
    return {
      organization,
      role,
      agencyDao,
      actorId: actorOf(context),
      capabilities: {
        canManageMembers: hasRole(ROLE_MATRIX.manage, role),
        canUseMoney: agencyDao !== null && hasRole(ROLE_MATRIX.work, role),
        hasAgencySections: hasRole(ROLE_MATRIX.work, role),
        hasClientSections: engagements.asClient.length > 0,
      },
      pluginContext: context,
    };
  }

  function scopeOf(access: OrganizationAccess, agencyDao: string): AgencyScope {
    return {
      organizationId: access.organization?.id ?? null,
      agencyDao,
      network: networkOf(agencyDao),
      role: access.role,
      actorId: access.actorId,
      canSeePrivate: hasRole(ROLE_MATRIX.seePrivate, access.role),
      pluginContext: access.pluginContext,
    };
  }

  async function publicScope(context: PluginContext): Promise<AgencyScope> {
    const access = await resolve(context);
    if (access.agencyDao) return scopeOf(access, access.agencyDao);
    if (!defaultDaoAccountId) {
      throw forbidden(
        "No DAO account configured. A platform admin must create an agency workspace with a Sputnik DAO.",
      );
    }
    return {
      organizationId: null,
      agencyDao: defaultDaoAccountId,
      network: networkOf(defaultDaoAccountId),
      role: null,
      actorId: access.actorId,
      canSeePrivate: false,
      pluginContext: context,
    };
  }

  async function agencyScope(
    context: PluginContext,
    requiredRoles: readonly OrganizationRole[],
  ): Promise<AgencyScope> {
    const access = await resolve(context);
    if (!hasRole(requiredRoles, access.role)) {
      throw forbidden(`Requires agency role: ${requiredRoles.join(" or ")}`, {
        requiredRoles,
        currentRole: access.role,
      });
    }
    if (!access.agencyDao) {
      throw forbidden(
        "This workspace has no DAO. Switch to an agency using the agency menu in the header.",
      );
    }
    return scopeOf(access, access.agencyDao);
  }

  function requireDefaultOrganization(scope: AgencyScope): void {
    if (!defaultDaoAccountId || scope.agencyDao !== defaultDaoAccountId) {
      throw forbidden("Only members of the default organization can manage applications.");
    }
  }

  function sharedProjectsScope(context: PluginContext, owningAgencyDao: string): AgencyScope {
    return {
      organizationId: null,
      agencyDao: owningAgencyDao,
      network: networkOf(owningAgencyDao),
      role: null,
      actorId: actorOf(context),
      canSeePrivate: true,
      pluginContext: {
        ...context,
        organization: {
          activeOrganizationId: owningAgencyDao,
          organization: {
            id: owningAgencyDao,
            name: owningAgencyDao,
            slug: owningAgencyDao,
            metadata: { daoAccountId: owningAgencyDao, type: "agency" as const },
          },
          member: { role: "member" as const },
        },
      },
    };
  }

  async function projectIdsByClient(clientIds: string[]): Promise<Map<string, string[]>> {
    const byClient = new Map<string, string[]>();
    if (clientIds.length === 0) return byClient;
    const rows = await db
      .select()
      .from(clientProjects)
      .where(inArray(clientProjects.clientId, clientIds));
    for (const row of rows) {
      const list = byClient.get(row.clientId) ?? [];
      list.push(row.projectId);
      byClient.set(row.clientId, list);
    }
    return byClient;
  }

  async function walletClients(nearAccountId: string): Promise<ClientMembership[]> {
    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.nearAccountId, nearAccountId))
      .orderBy(desc(clients.updatedAt));
    const byClient = await projectIdsByClient(rows.map((r) => r.id));
    return rows.map((client) => ({ client, projectIds: byClient.get(client.id) ?? [] }));
  }

  type AccessMiddleware = DecoratedMiddleware<
    AuthContext,
    { scope: AgencyScope },
    any,
    any,
    any,
    any
  >;

  function middleware(builder: any) {
    const requireAgency = (roles: readonly OrganizationRole[], defaultOnly: boolean) =>
      builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { authType: "session", hint: "Sign in to continue" },
          });
        }
        const scope = await agencyScope(context, roles);
        if (defaultOnly) requireDefaultOrganization(scope);
        return next({ context: { scope } });
      }) as AccessMiddleware;

    return {
      member: requireAgency(ROLE_MATRIX.work, false),
      manager: requireAgency(ROLE_MATRIX.manage, false),
      defaultOrganizationMember: requireAgency(ROLE_MATRIX.work, true),
      defaultOrganizationManager: requireAgency(ROLE_MATRIX.manage, true),
    };
  }

  return {
    resolve,
    publicScope,
    agencyScope,
    requireDefaultOrganization,
    middleware,
    sharedProjectsScope,

    engagements: async (_access: OrganizationAccess): Promise<Engagements> => NO_ENGAGEMENTS,

    projectRelation: async (
      scope: AgencyScope,
      projectId: string,
    ): Promise<ProjectRelation | null> => {
      try {
        await directory.forAgency(scope).require(projectId);
        return "owned";
      } catch {
        return null;
      }
    },

    clientMemberships: (caller: PluginContext, nearAccountId: string) =>
      Effect.gen(function* () {
        const own = new Set([
          ...(caller.near?.primaryAccountId ? [caller.near.primaryAccountId] : []),
          ...(caller.near?.linkedAccounts ?? []).map((a) => a.accountId),
        ]);
        if (!own.has(nearAccountId)) {
          return yield* Effect.fail(forbidden("You can only look up your own NEAR accounts"));
        }
        return yield* Effect.promise(() => walletClients(nearAccountId));
      }),

    clientPortal: (context: PluginContext, agencyDaoAccountId: string) =>
      Effect.gen(function* () {
        const nearAccountId = context.near?.primaryAccountId;
        if (!nearAccountId) {
          return yield* Effect.fail(
            forbidden("Sign in with your NEAR wallet to use the client portal."),
          );
        }
        const memberships = yield* Effect.promise(() => walletClients(nearAccountId));
        const membership = memberships.find(
          (m) => m.client.agencyDaoAccountId === agencyDaoAccountId,
        );
        if (!membership) {
          return yield* Effect.fail(
            forbidden(
              "No client portal for this wallet at this agency. Ask your agency to add your NEAR account under Clients.",
            ),
          );
        }
        return {
          ...membership,
          scope:
            membership.projectIds.length === 0
              ? null
              : sharedProjectsScope(context, membership.client.agencyDaoAccountId),
        };
      }),
  };
}

export type OrganizationAccessService = ReturnType<typeof createOrganizationAccess>;
