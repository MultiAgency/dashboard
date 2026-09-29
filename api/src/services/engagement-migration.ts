import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db";
import {
  budgets,
  clientProjects,
  clients,
  engagementProjects,
  engagements,
  organizationDaos,
  projectContributors,
} from "../db/schema";
import { isOwner, type OrganizationMembersStore } from "./organization-recovery";

export type MigratedClient = {
  clientId: string;
  clientName: string;
  engagementId: string | null;
  action: "created" | "existing" | "skipped";
  reason?: "UNMAPPED_AGENCY_DAO" | "SELF_ENGAGEMENT" | "ACTIVE_ENGAGEMENT_EXISTS";
  sharedProjects: number;
  repointedBudgets: number;
};

export type Handover = {
  organizationId: string;
  clientName: string;
  walletAccountId: string | null;
  ownerUserId: string | null;
  ownerAction: "promoted" | "added" | "already-owner" | "no-wallet-user" | "no-wallet";
  removedUserIds: string[];
};

export type EngagementMigrationReport = {
  clients: MigratedClient[];
  assignmentsWithOrganization: number;
  handovers: Handover[];
};

export function createEngagementMigration(deps: {
  db: Database;
  members?: OrganizationMembersStore;
  projectOrganizations?: (projectIds: string[]) => Promise<Map<string, string>>;
}) {
  const { db, members, projectOrganizations } = deps;

  async function agencyOrganizationOf(daoAccountId: string): Promise<string | null> {
    const [row] = await db
      .select()
      .from(organizationDaos)
      .where(eq(organizationDaos.daoAccountId, daoAccountId))
      .limit(1);
    return row?.organizationId ?? null;
  }

  async function migrateClient(
    client: typeof clients.$inferSelect,
    dryRun: boolean,
  ): Promise<MigratedClient> {
    const base = {
      clientId: client.id,
      clientName: client.name,
      sharedProjects: 0,
      repointedBudgets: 0,
    };
    const agencyOrganizationId = await agencyOrganizationOf(client.agencyDaoAccountId);
    if (!agencyOrganizationId) {
      return { ...base, engagementId: null, action: "skipped", reason: "UNMAPPED_AGENCY_DAO" };
    }
    if (agencyOrganizationId === client.orgId) {
      return { ...base, engagementId: null, action: "skipped", reason: "SELF_ENGAGEMENT" };
    }
    const [existing] = await db
      .select()
      .from(engagements)
      .where(eq(engagements.legacyClientId, client.id))
      .limit(1);
    const [activeOther] = existing
      ? []
      : await db
          .select({ id: engagements.id })
          .from(engagements)
          .where(
            and(
              eq(engagements.agencyOrganizationId, agencyOrganizationId),
              eq(engagements.clientOrganizationId, client.orgId),
              eq(engagements.status, "active"),
            ),
          )
          .limit(1);
    if (activeOther) {
      return {
        ...base,
        engagementId: activeOther.id,
        action: "skipped",
        reason: "ACTIVE_ENGAGEMENT_EXISTS",
      };
    }
    const links = await db
      .select({ projectId: clientProjects.projectId })
      .from(clientProjects)
      .where(eq(clientProjects.clientId, client.id));
    const pendingBudgets = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.clientId, client.id), isNull(budgets.engagementId)));
    if (dryRun) {
      return {
        ...base,
        engagementId: existing?.id ?? null,
        action: existing ? "existing" : "created",
        sharedProjects: links.length,
        repointedBudgets: pendingBudgets.length,
      };
    }

    return db.transaction(async (tx) => {
      const engagementId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        await tx.insert(engagements).values({
          id: engagementId,
          agencyOrganizationId,
          clientOrganizationId: client.orgId,
          kind: "client",
          status: "active",
          proposedBy: "migration",
          legacyClientId: client.id,
          createdAt: client.createdAt,
          decidedAt: client.createdAt,
        });
      }
      const shared =
        links.length > 0
          ? await tx
              .insert(engagementProjects)
              .values(links.map((l) => ({ engagementId, projectId: l.projectId })))
              .onConflictDoNothing()
              .returning()
          : [];
      const repointed = await tx
        .update(budgets)
        .set({ engagementId })
        .where(and(eq(budgets.clientId, client.id), isNull(budgets.engagementId)))
        .returning({ id: budgets.id });
      return {
        ...base,
        engagementId,
        action: existing ? ("existing" as const) : ("created" as const),
        sharedProjects: shared.length,
        repointedBudgets: repointed.length,
      };
    });
  }

  async function backfillAssignments(dryRun: boolean): Promise<number> {
    if (!projectOrganizations) return 0;
    const rows = await db
      .select({ projectId: projectContributors.projectId })
      .from(projectContributors)
      .where(isNull(projectContributors.organizationId));
    const byProject = await projectOrganizations([...new Set(rows.map((r) => r.projectId))]);
    if (dryRun) return rows.filter((r) => byProject.has(r.projectId)).length;
    let updated = 0;
    for (const [projectId, organizationId] of byProject) {
      const result = await db
        .update(projectContributors)
        .set({ organizationId })
        .where(
          and(
            eq(projectContributors.projectId, projectId),
            isNull(projectContributors.organizationId),
          ),
        )
        .returning({ projectId: projectContributors.projectId });
      updated += result.length;
    }
    return updated;
  }

  async function handOver(
    store: OrganizationMembersStore,
    client: typeof clients.$inferSelect,
    agencyOrganizationId: string,
    dryRun: boolean,
  ): Promise<Handover | null> {
    const roster = await store.roster(client.orgId);
    if (!roster || roster.organization.isPersonal) return null;
    const base = {
      organizationId: client.orgId,
      clientName: client.name,
      walletAccountId: client.nearAccountId,
    };
    if (!client.nearAccountId) {
      return { ...base, ownerUserId: null, ownerAction: "no-wallet", removedUserIds: [] };
    }
    const ownerUserId = await store.findUserIdByNearAccount(client.nearAccountId);
    if (!ownerUserId) {
      return { ...base, ownerUserId: null, ownerAction: "no-wallet-user", removedUserIds: [] };
    }
    const current = roster.members.find((m) => m.userId === ownerUserId);
    const ownerAction: Handover["ownerAction"] = !current
      ? "added"
      : isOwner(current)
        ? "already-owner"
        : "promoted";
    const agencyStaff = new Set(
      ((await store.roster(agencyOrganizationId))?.members ?? []).map((m) => m.userId),
    );
    const removed = roster.members.filter(
      (m) => m.userId !== ownerUserId && agencyStaff.has(m.userId),
    );
    if (!dryRun) {
      if (ownerAction === "added") {
        await store.addOwner({ organizationId: client.orgId, userId: ownerUserId });
      } else if (ownerAction === "promoted" && current) {
        await store.promoteToOwner({ memberId: current.memberId });
      }
      for (const member of removed) await store.removeMember({ memberId: member.memberId });
    }
    return { ...base, ownerUserId, ownerAction, removedUserIds: removed.map((m) => m.userId) };
  }

  return {
    run: async (input: { dryRun?: boolean } = {}): Promise<EngagementMigrationReport> => {
      const dryRun = input.dryRun === true;
      const rows = await db.select().from(clients);
      const report: EngagementMigrationReport = {
        clients: [],
        assignmentsWithOrganization: await backfillAssignments(dryRun),
        handovers: [],
      };
      for (const client of rows) {
        const migrated = await migrateClient(client, dryRun);
        report.clients.push(migrated);
        if (!members || migrated.reason === "UNMAPPED_AGENCY_DAO") continue;
        const agencyOrganizationId = await agencyOrganizationOf(client.agencyDaoAccountId);
        if (!agencyOrganizationId || agencyOrganizationId === client.orgId) continue;
        const handover = await handOver(members, client, agencyOrganizationId, dryRun);
        if (handover) report.handovers.push(handover);
      }
      return report;
    },
  };
}
