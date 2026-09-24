import { eq, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db";
import { organizationDaos, settings } from "../db/schema";
import type { SqlClient } from "../lib/auth-database";

export type OwnershipMove = { daoAccountId: string; organizationId: string; projectIds: string[] };

export type OwnershipReport = {
  movedProjects: OwnershipMove[];
  rekeyedSettings: Array<{ daoAccountId: string; organizationId: string }>;
};

export function createProjectOwnershipMigration(deps: { db: Database; projectsDb: SqlClient }) {
  const { db, projectsDb } = deps;

  async function projectIdsOwnedBy(daoAccountId: string): Promise<string[]> {
    const { rows } = await projectsDb.query<{ id: string }>(
      "SELECT id FROM projects WHERE organization_id = $1 ORDER BY id",
      [daoAccountId],
    );
    return rows.map((row) => row.id);
  }

  async function planSettings() {
    const current = alias(settings, "current");
    return db
      .select({
        daoAccountId: organizationDaos.daoAccountId,
        organizationId: organizationDaos.organizationId,
      })
      .from(settings)
      .innerJoin(organizationDaos, eq(settings.orgAccountId, organizationDaos.daoAccountId))
      .where(
        notExists(
          db
            .select()
            .from(current)
            .where(eq(current.orgAccountId, organizationDaos.organizationId)),
        ),
      );
  }

  return {
    run: async (options: { dryRun?: boolean } = {}): Promise<OwnershipReport> => {
      const mappings = await db.select().from(organizationDaos);
      const movedProjects: OwnershipMove[] = [];
      for (const { daoAccountId, organizationId } of mappings) {
        const projectIds = await projectIdsOwnedBy(daoAccountId);
        if (projectIds.length > 0) movedProjects.push({ daoAccountId, organizationId, projectIds });
      }
      const rekeyedSettings = await planSettings();
      const report = { movedProjects, rekeyedSettings };
      if (options.dryRun) return report;

      for (const move of movedProjects) {
        await projectsDb.query(
          "UPDATE projects SET organization_id = $1 WHERE organization_id = $2",
          [move.organizationId, move.daoAccountId],
        );
      }
      for (const move of rekeyedSettings) {
        await db
          .update(settings)
          .set({ orgAccountId: move.organizationId, daoAccountId: move.daoAccountId })
          .where(eq(settings.orgAccountId, move.daoAccountId));
      }
      return report;
    },
  };
}
