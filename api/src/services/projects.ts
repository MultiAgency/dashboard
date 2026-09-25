import { eq } from "drizzle-orm";
import type { Database } from "../db";
import {
  billings,
  budgets,
  clientProjects,
  engagementProjects,
  ideas,
  listings,
  projectContributors,
} from "../db/schema";

export type ProjectDeletionBlocker = "SHARED" | "BUDGET_ENTRIES" | "BILLINGS";

export async function projectDeletionBlockers(
  db: Database,
  projectId: string,
): Promise<ProjectDeletionBlocker[]> {
  const [shared, budget, billing] = await Promise.all([
    db
      .select({ id: engagementProjects.engagementId })
      .from(engagementProjects)
      .where(eq(engagementProjects.projectId, projectId))
      .limit(1),
    db.select({ id: budgets.id }).from(budgets).where(eq(budgets.projectId, projectId)).limit(1),
    db.select({ id: billings.id }).from(billings).where(eq(billings.projectId, projectId)).limit(1),
  ]);
  return [
    ...(shared.length > 0 ? (["SHARED"] as const) : []),
    ...(budget.length > 0 ? (["BUDGET_ENTRIES"] as const) : []),
    ...(billing.length > 0 ? (["BILLINGS"] as const) : []),
  ];
}

export async function deleteProjectCascade(db: Database, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(projectContributors).where(eq(projectContributors.projectId, projectId));
    await tx.delete(listings).where(eq(listings.projectId, projectId));
    await tx.delete(clientProjects).where(eq(clientProjects.projectId, projectId));
    await tx.delete(ideas).where(eq(ideas.projectId, projectId));
  });
}
