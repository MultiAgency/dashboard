import { and, eq, or } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Engagement, engagementProjects, engagements, organizationDaos } from "../db/schema";
import type { ProjectDirectory } from "../services/project-directory";
import {
  type AgencyRole,
  type AgencyScope,
  agencyScopeFromRequest,
  type OrgScope,
  orgScopeFromRequest,
  type PluginContext,
} from "./agency-scope";

export type Organizations = {
  daoOf(organizationId: string): Promise<string | null>;
  nameOf(context: PluginContext, organizationId: string): Promise<string | null>;
};

const alreadyLinked = () =>
  new ORPCError("FORBIDDEN", {
    message: "This DAO is already linked to another Organization.",
  });

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type ProjectRelation = "owned" | "client" | "subcontractor";

export type PartyEngagement = {
  id: string;
  kind: "client" | "subcontract";
  status: "proposed" | "active" | "declined" | "ended";
  role: "agency" | "client";
  agencyOrganizationId: string;
  agencyName: string;
  clientOrganizationId: string;
  clientName: string;
  createdAt: Date;
  endedAt: Date | null;
};

export async function projectRelation(
  db: Database,
  directory: ProjectDirectory,
  scope: OrgScope,
  projectId: string,
): Promise<ProjectRelation> {
  try {
    await directory.forAgency(scope).require(projectId);
    return "owned";
  } catch (ownerError) {
    const [row] = await db
      .select({ kind: engagements.kind })
      .from(engagementProjects)
      .innerJoin(engagements, eq(engagements.id, engagementProjects.engagementId))
      .where(
        and(
          eq(engagementProjects.projectId, projectId),
          eq(engagements.clientOrganizationId, scope.organizationId),
          eq(engagements.status, "active"),
        ),
      )
      .limit(1);
    if (!row) throw ownerError;
    return row.kind === "subcontract" ? "subcontractor" : "client";
  }
}

function partyEngagement(row: Engagement, organizationId: string): PartyEngagement {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    role: row.agencyOrganizationId === organizationId ? "agency" : "client",
    agencyOrganizationId: row.agencyOrganizationId,
    agencyName: row.agencyName,
    clientOrganizationId: row.clientOrganizationId,
    clientName: row.clientName,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  };
}

export function createOrganizationAccess(
  db: Database,
  organizations: Organizations,
  directory: ProjectDirectory,
) {
  const verified = new Map<string, string>();

  async function claim(organizationId: string, daoAccountId: string): Promise<void> {
    if (verified.get(organizationId) === daoAccountId) return;
    const [owner] = await db
      .select({ organizationId: organizationDaos.organizationId })
      .from(organizationDaos)
      .where(eq(organizationDaos.daoAccountId, daoAccountId))
      .limit(1);
    if (owner && owner.organizationId !== organizationId) throw alreadyLinked();
    if (!owner) {
      try {
        await db
          .insert(organizationDaos)
          .values({ organizationId, daoAccountId })
          .onConflictDoUpdate({ target: organizationDaos.organizationId, set: { daoAccountId } });
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyLinked();
        throw error;
      }
    }
    verified.set(organizationId, daoAccountId);
  }

  async function organizationOwning(daoAccountId: string): Promise<string | null> {
    const [row] = await db
      .select({ organizationId: organizationDaos.organizationId })
      .from(organizationDaos)
      .where(eq(organizationDaos.daoAccountId, daoAccountId))
      .limit(1);
    return row?.organizationId ?? null;
  }

  async function settle<S extends OrgScope>(scope: S): Promise<S> {
    if (!scope.agencyDao) return scope;
    if (scope.organizationId !== scope.agencyDao) {
      await claim(scope.organizationId, scope.agencyDao);
      return scope;
    }
    const owner = await organizationOwning(scope.agencyDao);
    return owner ? { ...scope, organizationId: owner } : scope;
  }

  return {
    scope: async (
      context: PluginContext,
      requiredRoles?: readonly AgencyRole[],
    ): Promise<AgencyScope> => settle(agencyScopeFromRequest(context, requiredRoles)),

    orgScope: async (
      context: PluginContext,
      requiredRoles?: readonly AgencyRole[],
    ): Promise<OrgScope> => settle(orgScopeFromRequest(context, requiredRoles)),

    daoOf: async (organizationId: string): Promise<string | null> => {
      const [row] = await db
        .select({ daoAccountId: organizationDaos.daoAccountId })
        .from(organizationDaos)
        .where(eq(organizationDaos.organizationId, organizationId))
        .limit(1);
      if (row) return row.daoAccountId;
      return organizations.daoOf(organizationId);
    },

    projectAccess: async (scope: OrgScope, projectId: string): Promise<ProjectRelation | null> => {
      try {
        return await projectRelation(db, directory, scope, projectId);
      } catch {
        return null;
      }
    },

    engagements: async (scope: OrgScope): Promise<PartyEngagement[]> => {
      const rows = await db
        .select()
        .from(engagements)
        .where(
          or(
            eq(engagements.agencyOrganizationId, scope.organizationId),
            eq(engagements.clientOrganizationId, scope.organizationId),
          ),
        );
      return rows.map((row) => partyEngagement(row, scope.organizationId));
    },
  };
}

export type OrganizationAccess = ReturnType<typeof createOrganizationAccess>;
