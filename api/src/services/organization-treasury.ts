import { and, eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { organizationDaos } from "../db/schema";
import type { OrgScope } from "../lib/agency-scope";
import { parseOrgMetadata } from "../lib/org";
import type { PluginsClient } from "../lib/plugins-types.gen";
import { getRoles, isSputnikDao } from "./sputnik";

export function createOrganizationTreasuryService(db: Database, auth: PluginsClient["auth"]) {
  return {
    connect: async (
      scope: OrgScope,
      daoAccountId: string,
      walletId: string | null,
      reqHeaders?: Headers,
    ) => {
      if (scope.agencyDao) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This Organization already has an Agency DAO.",
        });
      }
      if (!walletId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Link your NEAR wallet before connecting a treasury.",
        });
      }
      if (!isSputnikDao(daoAccountId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Enter a Sputnik DAO account.",
        });
      }
      let roles: Awaited<ReturnType<typeof getRoles>>;
      try {
        roles = await getRoles(daoAccountId);
      } catch {
        throw new ORPCError("BAD_REQUEST", {
          message: "Could not find a Sputnik DAO at this account.",
        });
      }
      if (!roles.some((role) => role.members.includes(walletId))) {
        throw new ORPCError("FORBIDDEN", {
          message: "Your linked wallet must be a member of this DAO.",
        });
      }

      const [existing] = await db
        .select()
        .from(organizationDaos)
        .where(eq(organizationDaos.organizationId, scope.organizationId))
        .limit(1);
      if (existing && existing.daoAccountId !== daoAccountId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This Organization already has an Agency DAO.",
        });
      }
      let reserved = false;
      if (!existing) {
        const rows = await db
          .insert(organizationDaos)
          .values({ organizationId: scope.organizationId, daoAccountId })
          .onConflictDoNothing()
          .returning();
        reserved = rows.length > 0;
        if (!reserved) {
          throw new ORPCError("CONFLICT", {
            message: "This DAO is already linked to another Organization.",
          });
        }
      }

      try {
        const metadata = parseOrgMetadata(scope.pluginContext.organization?.organization?.metadata);
        await auth({ reqHeaders }).updateOrganization({
          organizationId: scope.organizationId,
          data: { metadata: { ...metadata, daoAccountId } },
        });
      } catch (error) {
        if (reserved) {
          await db
            .delete(organizationDaos)
            .where(
              and(
                eq(organizationDaos.organizationId, scope.organizationId),
                eq(organizationDaos.daoAccountId, daoAccountId),
              ),
            );
        }
        throw error;
      }
      return { daoAccountId };
    },
  };
}
