import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { DecoratedMiddleware } from "every-plugin/orpc";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  type EngagementRow,
  engagementProjects,
  engagements,
  organizationDaos,
} from "../db/schema";
import type { AuthContext } from "../lib/auth";
import { getNetwork, type Network } from "../lib/network";
import type {
  Organization,
  OrganizationRole,
  Organizations,
  PluginContext,
} from "../lib/organizations";
import type { Project, ProjectDirectory } from "./project-directory";

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

export const SHARED_STATUSES: EngagementRow["status"][] = ["active", "ended"];

export type OrganizationAccess = {
  organization: Organization | null;
  role: OrganizationRole | null;
  agencyDao: string | null;
  actorId: string;
  capabilities: Capabilities;
  pluginContext: PluginContext;
};

export type SharedEngagement = {
  engagement: EngagementRow;
  readOnly: boolean;
  projectIds: string[];
  scope: AgencyScope;
  viewerAgencyDao: string | null;
};

export type SubcontractedProject = {
  project: Project;
  engagement: EngagementRow;
  readOnly: boolean;
  ownerScope: AgencyScope;
};

export type WorkableProject = {
  project: Project;
  relation: "owned" | "subcontractor";
  ownerScope: AgencyScope;
};

const projectNotFound = () => new ORPCError("NOT_FOUND", { message: "Project not found" });

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
  directory: ProjectDirectory;
  defaultDaoAccountId?: string;
}) {
  const { db, organizations, directory, defaultDaoAccountId } = deps;

  async function resolve(context: PluginContext): Promise<OrganizationAccess> {
    const membership = context.userId ? await organizations.activeMembership(context) : null;
    const organization = membership?.organization ?? null;
    const role = organization && !organization.isPersonal ? (membership?.role ?? null) : null;
    const agencyDao =
      organization && !organization.isPersonal ? await agencyDaoOf(db, organization.id) : null;
    const hasClientSections =
      organization !== null && role !== null && (await isClientOfAnyAgency(organization.id));
    return {
      organization,
      role,
      agencyDao,
      actorId: actorOf(context),
      capabilities: {
        canManageMembers: hasRole(ROLE_MATRIX.manage, role),
        canUseMoney: agencyDao !== null && hasRole(ROLE_MATRIX.work, role),
        hasAgencySections: hasRole(ROLE_MATRIX.work, role),
        hasClientSections,
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

  async function isClientOfAnyAgency(organizationId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: engagements.id })
      .from(engagements)
      .where(
        and(
          eq(engagements.clientOrganizationId, organizationId),
          ne(engagements.status, "declined"),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async function sharedProjectIds(engagementId: string): Promise<string[]> {
    const rows = await db
      .select({ projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .where(eq(engagementProjects.engagementId, engagementId))
      .orderBy(asc(engagementProjects.createdAt));
    return rows.map((r) => r.projectId);
  }

  async function readScopeOfAgency(
    context: PluginContext,
    agencyOrganizationId: string,
  ): Promise<AgencyScope> {
    const agencyDao = await agencyDaoOf(db, agencyOrganizationId);
    return {
      organizationId: agencyOrganizationId,
      agencyDao,
      network: agencyDao ? networkOf(agencyDao) : getNetwork(context.reqHeaders),
      role: null,
      actorId: actorOf(context),
      canSeePrivate: true,
      pluginContext: {
        userId: context.userId,
        reqHeaders: context.reqHeaders,
        organization: {
          activeOrganizationId: agencyOrganizationId,
          organization: { id: agencyOrganizationId, metadata: {} },
          member: { role: "member" },
        },
      },
    };
  }

  async function sharedWith(
    context: PluginContext,
    engagementId: string,
  ): Promise<SharedEngagement> {
    const access = await resolve(context);
    const [engagement] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.id, engagementId))
      .limit(1);
    if (
      !engagement ||
      !access.organization ||
      engagement.clientOrganizationId !== access.organization.id ||
      !hasRole(ROLE_MATRIX.work, access.role) ||
      !SHARED_STATUSES.includes(engagement.status)
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Engagement not found" });
    }
    return {
      engagement,
      readOnly: engagement.status !== "active",
      projectIds: await sharedProjectIds(engagement.id),
      scope: await readScopeOfAgency(context, engagement.agencyOrganizationId),
      viewerAgencyDao: access.agencyDao,
    };
  }

  async function subcontractedIn(
    scope: AgencyScope,
    projectId?: string,
  ): Promise<SubcontractedProject[]> {
    if (!scope.organizationId) return [];
    const rows = await db
      .select({ engagement: engagements, projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .innerJoin(engagements, eq(engagements.id, engagementProjects.engagementId))
      .where(
        and(
          eq(engagements.clientOrganizationId, scope.organizationId),
          eq(engagements.kind, "subcontract"),
          inArray(engagements.status, SHARED_STATUSES),
          projectId ? eq(engagementProjects.projectId, projectId) : undefined,
        ),
      )
      .orderBy(asc(engagements.status), asc(engagementProjects.createdAt));
    const byProject = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byProject.has(row.projectId)) byProject.set(row.projectId, row);
    }
    const ownerScopes = new Map<string, AgencyScope>();
    const found = await Promise.all(
      [...byProject.values()].map(async ({ engagement, projectId: id }) => {
        const agencyId = engagement.agencyOrganizationId;
        const ownerScope =
          ownerScopes.get(agencyId) ?? (await readScopeOfAgency(scope.pluginContext, agencyId));
        ownerScopes.set(agencyId, ownerScope);
        const project = await directory
          .forAgency(ownerScope)
          .require(id)
          .catch(() => null);
        return project
          ? { project, engagement, readOnly: engagement.status !== "active", ownerScope }
          : null;
      }),
    );
    return found.filter((p): p is SubcontractedProject => p !== null);
  }

  async function workableProject(
    scope: AgencyScope,
    projectId: string,
    options: { write?: boolean } = {},
  ): Promise<WorkableProject> {
    const owned = await directory
      .forAgency(scope)
      .require(projectId)
      .catch(() => null);
    if (owned) return { project: owned, relation: "owned", ownerScope: scope };
    const [shared] = await subcontractedIn(scope, projectId);
    if (!shared) throw projectNotFound();
    if (options.write && shared.readOnly) {
      throw forbidden("The subcontract has ended. Its shared Projects are read-only history.", {
        reason: "ENGAGEMENT_ENDED",
      });
    }
    return { project: shared.project, relation: "subcontractor", ownerScope: shared.ownerScope };
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

    defaultOrganization: async (): Promise<Pick<AgencyScope, "organizationId" | "agencyDao">> => ({
      organizationId: defaultDaoAccountId ? await organizationOfDao(defaultDaoAccountId) : null,
      agencyDao: defaultDaoAccountId ?? null,
    }),

    sharedWith,
    readScopeOfAgency,
    workableProject,
    subcontractedProjects: (scope: AgencyScope) => subcontractedIn(scope),
  };
}

export type OrganizationAccessService = ReturnType<typeof createOrganizationAccess>;
