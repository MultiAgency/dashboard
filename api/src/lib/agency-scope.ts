import type { DecoratedMiddleware } from "every-plugin/orpc";
import { ORPCError } from "every-plugin/orpc";
import type { AuthContext } from "./auth";
import type { Network } from "./network";
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

export type AgencyScope = {
  agencyDao: string;
  network: Network;
  role: AgencyRole | null;
  actorId: string;
  canSeePrivate: boolean;
  pluginContext: PluginContext;
};

const AGENCY_ROLES: readonly string[] = ["owner", "admin", "member", "contributor"];
const PRIVATE_ROLES: readonly string[] = ["owner", "admin", "contributor"];

function networkOf(agencyDao: string): Network {
  return agencyDao.endsWith(".testnet") ? "testnet" : "mainnet";
}

function actorOf(context: PluginContext): string {
  return context.near?.primaryAccountId ?? context.userId ?? "unknown";
}

function roleInAgency(context: PluginContext): AgencyRole | null {
  const metadata = parseOrgMetadata(context.organization?.organization?.metadata);
  if (!metadata.daoAccountId) return null;
  const rawRole = context.organization?.member?.role ?? null;
  return rawRole && AGENCY_ROLES.includes(rawRole) ? (rawRole as AgencyRole) : null;
}

export function agencyScopeFromRequest(
  context: PluginContext,
  requiredRoles?: readonly AgencyRole[],
): AgencyScope {
  const agencyDao = getDaoAccountIdOrThrow(context);
  const role = roleInAgency(context);
  if (requiredRoles && (role === null || !requiredRoles.includes(role))) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires agency role: ${requiredRoles.join(" or ")}`,
      data: { requiredRoles, currentRole: role },
    });
  }
  return {
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

export function createAgencyRoleMiddleware(builder: any) {
  const requireAgencyRole = (roles: readonly AgencyRole[]) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      return next({ context: { scope: agencyScopeFromRequest(context, roles) } });
    }) as AgencyRoleMiddleware;

  return {
    member: requireAgencyRole(AGENCY_MEMBER_ROLES),
    manager: requireAgencyRole(AGENCY_MANAGER_ROLES),
  };
}

export function agencyScopeForClient(context: PluginContext, agencyDao: string): AgencyScope {
  return {
    agencyDao,
    network: networkOf(agencyDao),
    role: null,
    actorId: actorOf(context),
    canSeePrivate: true,
    pluginContext: {
      ...context,
      organization: {
        activeOrganizationId: agencyDao,
        organization: {
          id: agencyDao,
          name: agencyDao,
          slug: agencyDao,
          metadata: { daoAccountId: agencyDao, type: "agency" as const },
        },
        member: { role: "member" as const },
      },
    },
  };
}
