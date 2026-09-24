import { and, desc, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { billings, organizationDaos, projectContributors } from "../db/schema";
import type { OrganizationDirectory, PluginContext } from "../lib/organizations";
import type { AgencyScope } from "./organization-access";
import type { Project, ProjectDirectory } from "./project-directory";
import { enrichWithChainStatus } from "./sputnik";

export function nearAccountsOf(context: PluginContext): string[] {
  return [
    ...new Set([
      ...(context.near?.primaryAccountId ? [context.near.primaryAccountId] : []),
      ...(context.near?.linkedAccounts ?? []).map((a) => a.accountId),
    ]),
  ];
}

export function createMeService(deps: {
  db: Database;
  directory: ProjectDirectory;
  organizations: Pick<OrganizationDirectory, "get">;
  readScopeOf: (context: PluginContext, organizationId: string) => Promise<AgencyScope>;
}) {
  const { db, directory, organizations, readScopeOf } = deps;

  async function assignments(context: PluginContext) {
    const accounts = nearAccountsOf(context);
    if (accounts.length === 0) return [];
    return db
      .select()
      .from(projectContributors)
      .where(inArray(projectContributors.nearAccount, accounts))
      .orderBy(desc(projectContributors.createdAt));
  }

  async function projectsByOrganization(
    context: PluginContext,
    rows: Array<{ projectId: string; organizationId: string | null }>,
  ) {
    const found = new Map<string, Project>();
    const organizationIds = [...new Set(rows.flatMap((r) => r.organizationId ?? []))];
    for (const organizationId of organizationIds) {
      const projects = directory.forAgency(await readScopeOf(context, organizationId));
      for (const row of rows.filter((r) => r.organizationId === organizationId)) {
        const project = await projects.require(row.projectId).catch(() => null);
        if (project) found.set(project.id, project);
      }
    }
    return found;
  }

  async function agencyNames(organizationIds: string[]) {
    const ids = [...new Set(organizationIds)];
    const found = await Promise.all(ids.map((id) => organizations.get(id)));
    return new Map(ids.map((id, i) => [id, found[i]?.name ?? id]));
  }

  return {
    assignedProjects: async (context: PluginContext) => {
      const rows = await assignments(context);
      const projects = await projectsByOrganization(context, rows);
      const names = await agencyNames(rows.flatMap((r) => r.organizationId ?? []));
      return {
        data: rows.flatMap((r) => {
          const project = projects.get(r.projectId);
          if (!project || !r.organizationId) return [];
          return [
            {
              projectId: r.projectId,
              projectSlug: project.slug,
              projectTitle: project.title,
              organizationId: r.organizationId,
              agencyName: names.get(r.organizationId) ?? r.organizationId,
              role: r.role,
              onboardingStatus: r.onboardingStatus,
              createdAt: r.createdAt,
            },
          ];
        }),
      };
    },

    billings: async (context: PluginContext, input: { cursor?: string; limit: number }) => {
      const accounts = nearAccountsOf(context);
      if (accounts.length === 0) return { data: [], nextCursor: null };
      const rows = await db
        .select({
          id: billings.id,
          projectId: billings.projectId,
          nearAccount: billings.nearAccount,
          tokenId: billings.tokenId,
          amount: billings.amount,
          proposalId: billings.proposalId,
          note: billings.note,
          createdAt: billings.createdAt,
        })
        .from(billings)
        .where(
          and(
            inArray(billings.nearAccount, accounts),
            cursorWhere(billings.createdAt, billings.id, input.cursor),
          ),
        )
        .orderBy(desc(billings.createdAt), desc(billings.id))
        .limit(input.limit);
      const assigned = await assignments(context);
      const organizationOf = new Map(
        assigned.flatMap((a) => (a.organizationId ? [[a.projectId, a.organizationId]] : [])),
      );
      const projects = await projectsByOrganization(
        context,
        rows.map((r) => ({
          projectId: r.projectId,
          organizationId: organizationOf.get(r.projectId) ?? null,
        })),
      );
      const organizationIds = [...new Set(organizationOf.values())];
      const daos =
        organizationIds.length > 0
          ? await db
              .select()
              .from(organizationDaos)
              .where(inArray(organizationDaos.organizationId, organizationIds))
          : [];
      const daoOf = new Map(daos.map((d) => [d.organizationId, d.daoAccountId]));
      const names = await agencyNames(organizationIds);
      const data = await Promise.all(
        rows.map(async (row) => {
          const organizationId = organizationOf.get(row.projectId) ?? null;
          const dao = organizationId ? daoOf.get(organizationId) : undefined;
          const project = projects.get(row.projectId);
          const enriched = dao
            ? await enrichWithChainStatus(db, row, dao)
            : { ...row, status: "InProgress" as const };
          return {
            ...enriched,
            projectTitle: project?.title ?? null,
            agencyName: organizationId ? (names.get(organizationId) ?? organizationId) : null,
          };
        }),
      );
      const last = rows[rows.length - 1];
      return {
        data,
        nextCursor: rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
      };
    },
  };
}

export type MeService = ReturnType<typeof createMeService>;
