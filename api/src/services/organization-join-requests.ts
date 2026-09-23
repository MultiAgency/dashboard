import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { organizationJoinRequests } from "../db/schema";
import type { PluginsClient } from "../lib/plugins-types.gen";

export function createOrganizationJoinRequestsService(db: Database, auth: PluginsClient["auth"]) {
  return {
    mine: (userId: string) =>
      db
        .select()
        .from(organizationJoinRequests)
        .where(eq(organizationJoinRequests.userId, userId))
        .orderBy(desc(organizationJoinRequests.updatedAt)),

    forOrganization: (organizationId: string) =>
      db
        .select()
        .from(organizationJoinRequests)
        .where(
          and(
            eq(organizationJoinRequests.organizationId, organizationId),
            eq(organizationJoinRequests.status, "pending"),
          ),
        )
        .orderBy(organizationJoinRequests.createdAt),

    request: async (
      organizationId: string,
      userId: string,
      displayName: string,
      reqHeaders?: Headers,
    ) => {
      const memberships = await auth({ reqHeaders }).listOrganizations();
      if (memberships.some((organization) => organization.id === organizationId)) {
        throw new ORPCError("BAD_REQUEST", { message: "You already belong to this Organization." });
      }
      const [request] = await db
        .insert(organizationJoinRequests)
        .values({ id: crypto.randomUUID(), organizationId, userId, displayName })
        .onConflictDoUpdate({
          target: [organizationJoinRequests.organizationId, organizationJoinRequests.userId],
          set: { status: "pending", displayName, updatedAt: new Date() },
        })
        .returning();
      return request!;
    },

    review: async (
      organizationId: string,
      id: string,
      decision: "approve" | "decline",
      reqHeaders?: Headers,
    ) => {
      const [request] = await db
        .select()
        .from(organizationJoinRequests)
        .where(
          and(
            eq(organizationJoinRequests.id, id),
            eq(organizationJoinRequests.organizationId, organizationId),
            eq(organizationJoinRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (!request) throw new ORPCError("NOT_FOUND", { message: "Join request not found" });
      if (decision === "approve") {
        await auth({ reqHeaders }).addMember({
          organizationId,
          userId: request.userId,
          role: "member",
        });
      }
      const [updated] = await db
        .update(organizationJoinRequests)
        .set({ status: decision === "approve" ? "approved" : "declined", updatedAt: new Date() })
        .where(
          and(eq(organizationJoinRequests.id, id), eq(organizationJoinRequests.status, "pending")),
        )
        .returning();
      return updated ?? request;
    },
  };
}
