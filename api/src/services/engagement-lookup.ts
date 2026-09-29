import { eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type EngagementRow, engagements } from "../db/schema";
import { type OrganizationScope, SHARED_STATUSES } from "./organization-access";

export const engagementNotFound = () =>
  new ORPCError("NOT_FOUND", { message: "Engagement not found" });

export const badRequest = (reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", { message, data: { reason } });

export async function loadEngagement(db: Database, id: string): Promise<EngagementRow | null> {
  const [row] = await db.select().from(engagements).where(eq(engagements.id, id)).limit(1);
  return row ?? null;
}

export async function readableEngagement(
  db: Database,
  scope: OrganizationScope,
  engagementId: string,
  options: { clientKind?: EngagementRow["kind"] } = {},
) {
  const row = await loadEngagement(db, engagementId);
  if (row?.agencyOrganizationId === scope.organizationId) return { row, side: "agency" as const };
  if (
    row?.clientOrganizationId === scope.organizationId &&
    (!options.clientKind || row.kind === options.clientKind) &&
    SHARED_STATUSES.includes(row.status)
  ) {
    return { row, side: "client" as const };
  }
  throw engagementNotFound();
}
