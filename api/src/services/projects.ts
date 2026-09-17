import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { billings, budgets, clientProjects, listings, projectContributors } from "../db/schema";

// Transactional cascade; add new project-scoped tables here.
export async function deleteProjectCascade(db: Database, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(billings).where(eq(billings.projectId, projectId));
    await tx.delete(budgets).where(eq(budgets.projectId, projectId));
    await tx.delete(projectContributors).where(eq(projectContributors.projectId, projectId));
    await tx.delete(listings).where(eq(listings.projectId, projectId));
    await tx.delete(clientProjects).where(eq(clientProjects.projectId, projectId));
  });
}
