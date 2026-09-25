import { desc, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { DecoratedMiddleware } from "every-plugin/orpc";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Client, clientProjects, clients, organizationDaos } from "../db/schema";
import type { AuthContext } from "../lib/auth";
import { getNetwork, type Network } from "../lib/network";
import type {
  Organization,
  OrganizationRole,
  Organizations,
  PluginContext,
} from "../lib/organizations";

export type AgencyScope = {
  organizationId: string | null;
  agencyDao: string | null;
  network: Network;
  role: OrganizationRole | null;
  actorId: string;
  canSeePrivate: boolean;
  pluginContext: PluginContext;
};

export type TreasuryScope = AgencyScope & { agencyDao: string };

export type OrganizationScope = AgencyScope & { organizationId: string };

export const NO_AGENCY_DAO = "NO_AGENCY_DAO";

export const ROLE_MATRIX = {
  work: ["owner", "admin", "member"],
  manage: ["owner", "admin"],
  seePrivate: ["owner", "admin", "member", "contributor"],
} as const satisfies Record<string, readonly OrganizationRole[]>;

export type Capabilities = {
  canManageMembers: boolean;
  canUseMoney: boolean;
  hasAgencySections: boolean;
  hasClientSections: boolean;
};

export type OrganizationAccess = {
  organization: Organization | null;
  role: OrganizationRole | null;
  agencyDao: string | null;
  actorId: string;
  capabilities: Capabilities;
  pluginContext: PluginContext;
};

export type ClientMembership = { client: Client; projectIds: string[] };

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

export function requireTreasury<TScope extends AgencyScope>(scope: TScope): TScope & TreasuryScope {
  if (!scope.agencyDao) {
    throw forbidden(
      "This Organization has no Agency DAO. Connect a treasury in Settings → Treasury to use money features.",
      { reason: NO_AGENCY_DAO },
    );
  }
  return scope as TScope & TreasuryScope;
}

export async function agencyDaoOf(db: Database, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(organizationDaos)
    .where(eq(organizationDaos.organizationId, organizationId))
    .limit(1);
  return row?.daoAccountId ?? null;
}

export function createOrganizationAccess(deps: {
  db: Database;
  organizations: Organizations;
  defaultDaoAccountId?: string;
}) {
  const { db, organizations, defaultDaoAccountId } = deps;

  async function resolve(context: PluginContext): Promise<OrganizationAccess> {
    const membership = context.userId ? await organizations.activeMembership(context) : null;
    const organization = membership?.organization ?? null;
    const role = organization && !organization.isPersonal ? (membership?.role ?? null) : null;
    const agencyDao =
      organization && !organization.isPersonal ? await agencyDaoOf(db, organization.id) : null;
    return {
      organization,
      role,
      agencyDao,
      actorId: actorOf(context),
      capabilities: {
        canManageMembers: hasRole(ROLE_MATRIX.manage, role),
        canUseMoney: agencyDao !== null && hasRole(ROLE_MATRIX.work, role),
        hasAgencySections: hasRole(ROLE_MATRIX.work, role),
        hasClientSections: false,
      },
      pluginContext: context,
    };
  }

  async function organizationOfDao(daoAccountId: string): Promise<string | null> {
    const [row] = await db
      .select()
      .from(organizationDaos)
      .where(eq(organizationDaos.daoAccountId, daoAccountId))
      .limit(1);
    return row?.organizationId ?? null;
  }

  function scopeOf(access: OrganizationAccess): AgencyScope {
    const { agencyDao } = access;
    return {
      organizationId: access.organization?.id ?? null,
      agencyDao,
      network: agencyDao ? networkOf(agencyDao) : getNetwork(access.pluginContext.reqHeaders),
      role: access.role,
      actorId: access.actorId,
      canSeePrivate: hasRole(ROLE_MATRIX.seePrivate, access.role),
      pluginContext: access.pluginContext,
    };
  }

  async function publicScope(context: PluginContext): Promise<TreasuryScope> {
    if (!defaultDaoAccountId) {
      throw forbidden(
        "No default Organization configured. Set the deployment's default Agency DAO.",
      );
    }
    return {
      organizationId: await organizationOfDao(defaultDaoAccountId),
      agencyDao: defaultDaoAccountId,
      network: networkOf(defaultDaoAccountId),
      role: null,
      actorId: actorOf(context),
      canSeePrivate: false,
      pluginContext: {},
    };
  }

  async function publicTreasuryScope(context: PluginContext): Promise<TreasuryScope> {
    const access = await resolve(context);
    if (access.role && defaultDaoAccountId && access.agencyDao === defaultDaoAccountId) {
      return requireTreasury(scopeOf(access));
    }
    return publicScope(context);
  }

  async function agencyScope(
    context: PluginContext,
    requiredRoles: readonly OrganizationRole[],
  ): Promise<OrganizationScope> {
    const access = await resolve(context);
    if (!access.organization || !hasRole(requiredRoles, access.role)) {
      throw forbidden(`Requires agency role: ${requiredRoles.join(" or ")}`, {
        requiredRoles,
        currentRole: access.role,
      });
    }
    return { ...scopeOf(access), organizationId: access.organization.id };
  }

  function requireDefaultOrganization(scope: AgencyScope): void {
    if (!defaultDaoAccountId || scope.agencyDao !== defaultDaoAccountId) {
      throw forbidden("Only members of the default organization can manage applications.");
    }
  }

  async function sharedProjectsScope(
    context: PluginContext,
    owningAgencyDao: string,
  ): Promise<TreasuryScope> {
    const organizationId = await organizationOfDao(owningAgencyDao);
    const owningOrganizationId = organizationId ?? owningAgencyDao;
    return {
      organizationId,
      agencyDao: owningAgencyDao,
      network: networkOf(owningAgencyDao),
      role: null,
      actorId: actorOf(context),
      canSeePrivate: true,
      pluginContext: {
        ...context,
        organization: {
          activeOrganizationId: owningOrganizationId,
          organization: {
            id: owningOrganizationId,
            name: owningOrganizationId,
            slug: owningOrganizationId,
            metadata: {},
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

  type AccessMiddleware<TScope extends AgencyScope> = DecoratedMiddleware<
    AuthContext,
    { scope: TScope },
    any,
    any,
    any,
    any
  >;

  function middleware(builder: any) {
    const requireScope = <TScope extends AgencyScope>(
      roles: readonly OrganizationRole[],
      narrow: (scope: OrganizationScope) => TScope,
    ) =>
      builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { authType: "session", hint: "Sign in to continue" },
          });
        }
        const scope = narrow(await agencyScope(context, roles));
        return next({ context: { scope } });
      }) as AccessMiddleware<TScope>;

    const agency = (scope: OrganizationScope) => scope;
    const defaultOrganization = (scope: OrganizationScope) => {
      requireDefaultOrganization(scope);
      return scope;
    };

    return {
      member: requireScope(ROLE_MATRIX.work, agency),
      manager: requireScope(ROLE_MATRIX.manage, agency),
      treasuryMember: requireScope(ROLE_MATRIX.work, requireTreasury),
      treasuryManager: requireScope(ROLE_MATRIX.manage, requireTreasury),
      defaultOrganizationMember: requireScope(ROLE_MATRIX.work, defaultOrganization),
      defaultOrganizationManager: requireScope(ROLE_MATRIX.manage, defaultOrganization),
    };
  }

  return {
    resolve,
    publicScope,
    publicTreasuryScope,
    agencyScope,
    requireDefaultOrganization,
    middleware,
    sharedProjectsScope,

    defaultOrganization: async (): Promise<Pick<AgencyScope, "organizationId" | "agencyDao">> => ({
      organizationId: defaultDaoAccountId ? await organizationOfDao(defaultDaoAccountId) : null,
      agencyDao: defaultDaoAccountId ?? null,
    }),

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
        const scope =
          membership.projectIds.length === 0
            ? null
            : yield* Effect.promise(() =>
                sharedProjectsScope(context, membership.client.agencyDaoAccountId),
              );
        return { ...membership, scope };
      }),
  };
}

export type OrganizationAccessService = ReturnType<typeof createOrganizationAccess>;
