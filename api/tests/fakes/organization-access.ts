import {
  agencyScopeFromRequest,
  orgScopeFromRequest,
  type PluginContext,
} from "../../src/lib/agency-scope";
import type {
  OrganizationAccess,
  Organizations,
  PartyEngagement,
  ProjectRelation,
} from "../../src/lib/organization-access";
import type { ProjectDirectory } from "../../src/services/project-directory";

export function inMemoryOrganizationAccess(
  organizations: Organizations,
  directory: ProjectDirectory,
  engagements: PartyEngagement[] = [],
): OrganizationAccess {
  return {
    scope: async (context, requiredRoles) => agencyScopeFromRequest(context, requiredRoles),
    orgScope: async (context, requiredRoles) =>
      orgScopeFromRequest(context as PluginContext & { reqHeaders?: Headers }, requiredRoles),
    daoOf: (organizationId) => organizations.daoOf(organizationId),
    projectAccess: async (scope, projectId): Promise<ProjectRelation | null> => {
      try {
        await directory.forAgency(scope).require(projectId);
        return "owned";
      } catch {
        return null;
      }
    },
    engagements: async (scope) =>
      engagements.filter(
        (engagement) =>
          engagement.agencyOrganizationId === scope.organizationId ||
          engagement.clientOrganizationId === scope.organizationId,
      ),
  };
}
