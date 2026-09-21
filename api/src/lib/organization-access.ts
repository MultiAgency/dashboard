import { eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { organizationDaos } from "../db/schema";
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

export function createOrganizationAccess(db: Database, organizations: Organizations) {
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
  };
}

export type OrganizationAccess = ReturnType<typeof createOrganizationAccess>;
