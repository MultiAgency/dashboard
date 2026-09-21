import type { DecoratedMiddleware } from "every-plugin/orpc";
import { ORPCError } from "every-plugin/orpc";
import type { AuthContext } from "./auth";
import { getNetwork, type Network } from "./network";
import { getDaoAccountIdOrThrow, parseOrgMetadata } from "./org";

export type AgencyRole = "owner" | "admin" | "member" | "contributor";

export const AGENCY_MEMBER_ROLES = [
  "admin",
  "owner",
  "member",
] as const satisfies readonly AgencyRole[];
export const AGENCY_MANAGER_ROLES = ["admin", "owner"] as const satisfies readonly AgencyRole[];

export type PluginContext = {
  userId?: string | null;
  near?: { primaryAccountId?: string | null } | null;
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

export type OrgScope = {
  organizationId: string;
  agencyDao: string | null;
  network: Network;
  role: AgencyRole | null;
  actorId: string;
  canSeePrivate: boolean;
  pluginContext: PluginContext;
};

export type AgencyScope = OrgScope & { agencyDao: string };

export function hasAgencyDao(scope: OrgScope): scope is AgencyScope {
  return scope.agencyDao !== null;
}

const noAgencyDao = () =>
  new ORPCError("FORBIDDEN", {
    message: "Connect a treasury (Agency DAO) to your Organization to use money features.",
    data: { reason: "NO_AGENCY_DAO" },
  });

export function requireAgencyDao(scope: OrgScope): AgencyScope {
  if (hasAgencyDao(scope)) return scope;
  throw noAgencyDao();
}

const AGENCY_ROLES: readonly string[] = ["owner", "admin", "member", "contributor"];
const PRIVATE_ROLES: readonly string[] = ["owner", "admin", "contributor"];

function networkOf(agencyDao: string): Network {
  return agencyDao.endsWith(".testnet") ? "testnet" : "mainnet";
}

export function organizationIdOf(context: PluginContext): string | null {
  return (
    context.organization?.activeOrganizationId ?? context.organization?.organization?.id ?? null
  );
}

function actorOf(context: PluginContext): string {
  return context.near?.primaryAccountId ?? context.userId ?? "unknown";
}

function memberRole(context: PluginContext): AgencyRole | null {
  const rawRole = context.organization?.member?.role ?? null;
  return rawRole && AGENCY_ROLES.includes(rawRole) ? (rawRole as AgencyRole) : null;
}

function roleInAgency(context: PluginContext): AgencyRole | null {
  const metadata = parseOrgMetadata(context.organization?.organization?.metadata);
  if (!metadata.daoAccountId) return null;
  return memberRole(context);
}

function assertRole(role: AgencyRole | null, requiredRoles?: readonly AgencyRole[]) {
  if (requiredRoles && (role === null || !requiredRoles.includes(role))) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires agency role: ${requiredRoles.join(" or ")}`,
      data: { requiredRoles, currentRole: role },
    });
  }
}

export function ownsOrganizationWithoutDao(context: PluginContext): boolean {
  const metadata = parseOrgMetadata(context.organization?.organization?.metadata);
  return (
    organizationIdOf(context) !== null &&
    !metadata.isPersonal &&
    !metadata.daoAccountId &&
    memberRole(context) !== null
  );
}

export function orgScopeFromRequest(
  context: PluginContext & { reqHeaders?: Headers },
  requiredRoles?: readonly AgencyRole[],
): OrgScope {
  if (!ownsOrganizationWithoutDao(context)) return agencyScopeFromRequest(context, requiredRoles);
  const role = memberRole(context);
  assertRole(role, requiredRoles);
  return {
    organizationId: organizationIdOf(context) as string,
    agencyDao: null,
    network: getNetwork(context.reqHeaders),
    role,
    actorId: actorOf(context),
    canSeePrivate: role !== null && PRIVATE_ROLES.includes(role),
    pluginContext: context,
  };
}

export function agencyScopeFromRequest(
  context: PluginContext,
  requiredRoles?: readonly AgencyRole[],
): AgencyScope {
  if (requiredRoles && ownsOrganizationWithoutDao(context)) throw noAgencyDao();
  const agencyDao = getDaoAccountIdOrThrow(context);
  const role = roleInAgency(context);
  assertRole(role, requiredRoles);
  const ownDao = parseOrgMetadata(context.organization?.organization?.metadata).daoAccountId;
  return {
    organizationId: (ownDao === agencyDao ? organizationIdOf(context) : null) ?? agencyDao,
    agencyDao,
    network: networkOf(agencyDao),
    role,
    actorId: actorOf(context),
    canSeePrivate: role !== null && PRIVATE_ROLES.includes(role),
    pluginContext: context,
  };
}

type AgencyRoleMiddleware = DecoratedMiddleware<
  AuthContext,
  { scope: AgencyScope },
  any,
  any,
  any,
  any
>;

type ScopeResolver = (
  context: PluginContext,
  requiredRoles?: readonly AgencyRole[],
) => Promise<AgencyScope>;

type OrgRoleMiddleware = DecoratedMiddleware<AuthContext, { scope: OrgScope }, any, any, any, any>;

export function createAgencyRoleMiddleware(
  builder: any,
  resolveScope: ScopeResolver,
  resolveOrgScope: (
    context: PluginContext,
    requiredRoles?: readonly AgencyRole[],
  ) => Promise<OrgScope>,
) {
  const requireSignedIn = (context: AuthContext) => {
    if (!context.user || !context.userId) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Authentication required",
        data: { authType: "session", hint: "Sign in to continue" },
      });
    }
  };

  const requireAgencyRole = (roles: readonly AgencyRole[]) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
      requireSignedIn(context);
      return next({ context: { scope: await resolveScope(context, roles) } });
    }) as AgencyRoleMiddleware;

  const requireOrgRole = (roles: readonly AgencyRole[]) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
      requireSignedIn(context);
      return next({ context: { scope: await resolveOrgScope(context, roles) } });
    }) as OrgRoleMiddleware;

  return {
    member: requireAgencyRole(AGENCY_MEMBER_ROLES),
    manager: requireAgencyRole(AGENCY_MANAGER_ROLES),
    orgMember: requireOrgRole(AGENCY_MEMBER_ROLES),
    orgManager: requireOrgRole(AGENCY_MANAGER_ROLES),
  };
}

export function sharedViewScope(
  viewer: OrgScope,
  agencyOrganizationId: string,
  agencyDao: string | null,
): OrgScope {
  return {
    organizationId: agencyOrganizationId,
    agencyDao,
    network: agencyDao ? networkOf(agencyDao) : viewer.network,
    role: null,
    actorId: viewer.actorId,
    canSeePrivate: true,
    pluginContext: {
      ...viewer.pluginContext,
      organization: {
        activeOrganizationId: agencyOrganizationId,
        organization: {
          id: agencyOrganizationId,
          name: agencyOrganizationId,
          slug: agencyOrganizationId,
          metadata: agencyDao ? { daoAccountId: agencyDao } : {},
        },
        member: { role: "member" as const },
      },
    },
  };
}
