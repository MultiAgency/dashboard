import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { clientProjects, organizationDaos } from "../db/schema";
import type { Organization, Organizations } from "../lib/organizations";

export type ExistingProjects = (projectIds: string[]) => Promise<Set<string>>;

export type CleanupReport = {
  removedOrganizations: string[];
  mappedOrganizations: Array<{ organizationId: string; daoAccountId: string }>;
  removedClientProjectLinks: Array<{ clientId: string; projectId: string }>;
};

function oldestFirst(a: Organization, b: Organization): number {
  const byDate = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
}

export function createOrganizationCleanup(deps: {
  db: Database;
  organizations: Organizations;
  existingProjects: ExistingProjects;
}) {
  const { db, organizations, existingProjects } = deps;

  async function agencyOrganizationsByDao(): Promise<Map<string, Organization[]>> {
    const byDao = new Map<string, Organization[]>();
    for (const organization of await organizations.list()) {
      const dao = organization.metadataDaoAccountId;
      if (organization.isPersonal || !dao) continue;
      byDao.set(dao, [...(byDao.get(dao) ?? []), organization]);
    }
    return byDao;
  }

  async function planOrganizations() {
    const mapped = await db.select().from(organizationDaos);
    const mappedByDao = new Map(mapped.map((row) => [row.daoAccountId, row.organizationId]));
    const mappedOrganizationIds = new Set(mapped.map((row) => row.organizationId));

    const removals: string[] = [];
    const mappings: CleanupReport["mappedOrganizations"] = [];
    for (const [daoAccountId, candidates] of await agencyOrganizationsByDao()) {
      const keeperId = mappedByDao.get(daoAccountId) ?? [...candidates].sort(oldestFirst)[0]!.id;
      removals.push(...candidates.filter((o) => o.id !== keeperId).map((o) => o.id));
      if (!mappedByDao.has(daoAccountId) && !mappedOrganizationIds.has(keeperId)) {
        mappings.push({ organizationId: keeperId, daoAccountId });
      }
    }
    return { removals, mappings };
  }

  async function planLinks(): Promise<CleanupReport["removedClientProjectLinks"]> {
    const links = await db.select().from(clientProjects);
    if (links.length === 0) return [];
    const existing = await existingProjects([...new Set(links.map((l) => l.projectId))]);
    return links
      .filter((l) => !existing.has(l.projectId))
      .map(({ clientId, projectId }) => ({ clientId, projectId }));
  }

  return {
    run: async (options: { dryRun?: boolean } = {}): Promise<CleanupReport> => {
      const { removals, mappings } = await planOrganizations();
      const danglingLinks = await planLinks();
      const report: CleanupReport = {
        removedOrganizations: removals,
        mappedOrganizations: mappings,
        removedClientProjectLinks: danglingLinks,
      };
      if (options.dryRun) return report;

      for (const organizationId of removals) await organizations.remove(organizationId);
      if (mappings.length > 0) {
        await db.insert(organizationDaos).values(mappings).onConflictDoNothing();
      }
      for (const link of danglingLinks) {
        await db
          .delete(clientProjects)
          .where(
            and(
              eq(clientProjects.clientId, link.clientId),
              eq(clientProjects.projectId, link.projectId),
            ),
          );
      }
      return report;
    },
  };
}

export type OrganizationCleanup = ReturnType<typeof createOrganizationCleanup>;
