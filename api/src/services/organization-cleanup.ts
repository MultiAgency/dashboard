import type { Database } from "../db";
import { organizationDaos } from "../db/schema";
import type { Organization, Organizations } from "../lib/organizations";

export type CleanupReport = {
  removedOrganizations: string[];
  mappedOrganizations: Array<{ organizationId: string; daoAccountId: string }>;
};

function oldestFirst(a: Organization, b: Organization): number {
  const byDate = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
}

export function createOrganizationCleanup(deps: { db: Database; organizations: Organizations }) {
  const { db, organizations } = deps;

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

  return {
    run: async (options: { dryRun?: boolean } = {}): Promise<CleanupReport> => {
      const { removals, mappings } = await planOrganizations();
      const report: CleanupReport = {
        removedOrganizations: removals,
        mappedOrganizations: mappings,
      };
      if (options.dryRun) return report;

      for (const organizationId of removals) await organizations.remove(organizationId);
      if (mappings.length > 0) {
        await db.insert(organizationDaos).values(mappings).onConflictDoNothing();
      }
      return report;
    },
  };
}
