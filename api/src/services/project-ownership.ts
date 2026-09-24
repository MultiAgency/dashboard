import { and, asc, eq, inArray, isNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db";
import { billings, budgets, organizationDaos, settings } from "../db/schema";
import type { SqlClient } from "../lib/auth-database";

export type OwnershipMove = { daoAccountId: string; organizationId: string; projectIds: string[] };

export type FundingBackfill = { daoAccountId: string; budgetIds: string[] };

export type PayingBackfill = { daoAccountId: string; billingIds: string[] };

export type OwnershipReport = {
  movedProjects: OwnershipMove[];
  rekeyedSettings: Array<{ daoAccountId: string; organizationId: string }>;
  fundedBudgets: FundingBackfill[];
  paidBillings: PayingBackfill[];
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

  async function projectIdsOf(daoAccountId: string, organizationId: string) {
    const { rows } = await projectsDb.query<{ id: string }>(
      "SELECT id FROM projects WHERE organization_id = $1 OR organization_id = $2",
      [daoAccountId, organizationId],
    );
    return rows.map((row) => row.id);
  }

  async function unfundedBudgetIds(projectIds: string[]) {
    if (projectIds.length === 0) return [];
    const unfunded = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(isNull(budgets.fundingDaoAccountId), inArray(budgets.projectId, projectIds)))
      .orderBy(asc(budgets.id));
    return unfunded.map((row) => row.id);
  }

  async function unpaidBillingIds(projectIds: string[]) {
    if (projectIds.length === 0) return [];
    const unpaid = await db
      .select({ id: billings.id })
      .from(billings)
      .where(and(isNull(billings.payingDaoAccountId), inArray(billings.projectId, projectIds)))
      .orderBy(asc(billings.id));
    return unpaid.map((row) => row.id);
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
      const fundedBudgets: FundingBackfill[] = [];
      const paidBillings: PayingBackfill[] = [];
      for (const { daoAccountId, organizationId } of mappings) {
        const projectIds = await projectIdsOf(daoAccountId, organizationId);
        const budgetIds = await unfundedBudgetIds(projectIds);
        if (budgetIds.length > 0) fundedBudgets.push({ daoAccountId, budgetIds });
        const billingIds = await unpaidBillingIds(projectIds);
        if (billingIds.length > 0) paidBillings.push({ daoAccountId, billingIds });
      }
      const report = { movedProjects, rekeyedSettings, fundedBudgets, paidBillings };
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
      for (const { daoAccountId, budgetIds } of fundedBudgets) {
        await db
          .update(budgets)
          .set({ fundingDaoAccountId: daoAccountId })
          .where(and(isNull(budgets.fundingDaoAccountId), inArray(budgets.id, budgetIds)));
      }
      for (const { daoAccountId, billingIds } of paidBillings) {
        await db
          .update(billings)
          .set({ payingDaoAccountId: daoAccountId })
          .where(and(isNull(billings.payingDaoAccountId), inArray(billings.id, billingIds)));
      }
      return report;
    },
  };
}
