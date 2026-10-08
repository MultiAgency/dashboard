import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import {
  billings,
  budgets,
  clientAgreements,
  engagementProjects,
  engagements,
  projectContributors,
  type ReportSnapshotRow,
  reportSnapshots,
} from "../db/schema";
import type { OrganizationDirectory } from "../lib/organizations";
import type { PluginsClient } from "../lib/plugins-types.gen";
import { ALLOCATION_PLAN_ENABLED } from "./budgets";
import type { NotificationsService } from "./notifications";
import { type AgencyScope, SHARED_STATUSES } from "./organization-access";
import { type ProjectDirectory, withoutClientIdeas } from "./project-directory";
import { sumByToken } from "./report-tokens";
import { enrichWithChainStatus } from "./sputnik";

export type ReportInput = {
  engagementId?: string;
  projectId?: string;
  note?: string;
  startDate?: string;
  endDate?: string;
  subcontractorDao?: string;
  forClient?: boolean;
  agreementId?: string;
};

export type ReportOwner = { organizationId: string; userId: string };

export type ReportViewer = {
  organizationId: string;
  userId: string;
  canManage: boolean;
  side: "agency" | "client";
};

const reportNotFound = () => new ORPCError("NOT_FOUND", { message: "Report not found" });

function summaryOf(row: ReportSnapshotRow, viewer?: ReportViewer) {
  const own = !viewer || row.organizationId === viewer.organizationId;
  return {
    id: row.id,
    engagementId: row.engagementId,
    generatedByUserId: row.generatedByUserId,
    startDate: row.startDate,
    endDate: row.endDate,
    note: row.note,
    projectTitle: projectTitleOf(row.payload),
    agreementTitle: agreementTitleOf(row.payload),
    sharedAt: row.sharedAt,
    fromAgency: !own,
    canDelete: !!viewer && own && (viewer.canManage || row.generatedByUserId === viewer.userId),
    canShare:
      !!viewer && own && viewer.side === "agency" && viewer.canManage && row.engagementId !== null,
    createdAt: row.createdAt,
  };
}

function periodOf(row: Pick<ReportSnapshotRow, "startDate" | "endDate">): string {
  if (row.startDate && row.endDate) return `${row.startDate} – ${row.endDate}`;
  if (row.startDate) return `from ${row.startDate}`;
  if (row.endDate) return `through ${row.endDate}`;
  return "all time";
}

export function clientSafe<R extends { contributorStats: unknown[] }>(report: R): R {
  return { ...report, contributorStats: [] };
}

function agreementTitleOf(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { agreement?: { title?: string } | null };
    return parsed.agreement?.title ?? null;
  } catch {
    return null;
  }
}

function projectTitleOf(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { project?: { title?: string } | null };
    return parsed.project?.title ?? null;
  } catch {
    return null;
  }
}

export function createReportsService(
  db: Database,
  directory: ProjectDirectory,
  plugins: PluginsClient,
  organizations: Pick<OrganizationDirectory, "get">,
  notifications?: Pick<NotificationsService, "notify">,
) {
  const generate = (scope: AgencyScope, requested: ReportInput) =>
    Effect.gen(function* () {
      const agreement = requested.agreementId
        ? yield* Effect.promise(async () => {
            const [row] = await db
              .select()
              .from(clientAgreements)
              .where(eq(clientAgreements.id, requested.agreementId!))
              .limit(1);
            return row ?? null;
          })
        : null;
      if (
        requested.agreementId &&
        (!agreement ||
          (requested.engagementId !== undefined &&
            requested.engagementId !== agreement.engagementId))
      ) {
        return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Agreement not found" }));
      }
      const input: ReportInput = agreement
        ? {
            ...requested,
            engagementId: agreement.engagementId,
            startDate: agreement.startDate,
            endDate: agreement.endDate,
          }
        : requested;
      const { agencyDao } = scope;
      const { subcontractorDao } = input;
      const allProjects = yield* Effect.promise(async () =>
        withoutClientIdeas(db, await directory.forAgency(scope).list()),
      );
      let projectIds: string[];

      const startAt = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null;
      const endAt = input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : null;
      if (startAt && endAt && startAt > endAt) {
        return yield* Effect.fail(
          new ORPCError("BAD_REQUEST", { message: "startDate must be on or before endDate" }),
        );
      }

      const within = (at: Date) => {
        if (startAt && at < startAt) return false;
        if (endAt && at > endAt) return false;
        return true;
      };
      const inPeriod = <T extends { createdAt: Date }>(row: T) => within(row.createdAt);
      const budgetInPeriod = (row: { effectiveOn: string | null; createdAt: Date }) =>
        within(row.effectiveOn ? new Date(`${row.effectiveOn}T00:00:00.000Z`) : row.createdAt);

      const agencyEngagements = scope.organizationId
        ? yield* Effect.promise(() =>
            db
              .select()
              .from(engagements)
              .where(
                and(
                  eq(engagements.agencyOrganizationId, scope.organizationId!),
                  inArray(engagements.status, ["active", "ended"]),
                ),
              ),
          )
        : [];
      const reported = input.engagementId
        ? agencyEngagements.filter((e) => e.id === input.engagementId)
        : agencyEngagements;
      if (input.engagementId && reported.length === 0) {
        return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Engagement not found" }));
      }
      const links =
        reported.length > 0
          ? yield* Effect.promise(() =>
              db
                .select()
                .from(engagementProjects)
                .where(
                  inArray(
                    engagementProjects.engagementId,
                    reported.map((e) => e.id),
                  ),
                ),
            )
          : [];

      const agencyProjectIds = new Set(allProjects.map((p) => p.id));
      projectIds = input.engagementId
        ? [...new Set(links.map((l) => l.projectId))].filter((id) => agencyProjectIds.has(id))
        : allProjects.map((p) => p.id);

      if (input.projectId) {
        if (!projectIds.includes(input.projectId)) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: input.engagementId
                ? "Project not shared through this Engagement"
                : "Project not found in this agency",
            }),
          );
        }
        projectIds = [input.projectId];
      }

      const projectById = new Map(allProjects.map((p) => [p.id, p]));

      const budgetRowsAll =
        projectIds.length > 0 && subcontractorDao === undefined
          ? yield* Effect.promise(() =>
              db.select().from(budgets).where(inArray(budgets.projectId, projectIds)),
            )
          : [];
      const billingRowsRawAll =
        projectIds.length > 0
          ? yield* Effect.promise(() =>
              db
                .select()
                .from(billings)
                .where(inArray(billings.projectId, projectIds))
                .orderBy(desc(billings.createdAt)),
            )
          : [];

      // Allocation plan omitted for now: budget is allocated to the Project, so a shared Project
      // reports all of its Budget entries, not only entries attributed to the Engagement.
      const budgetRows = budgetRowsAll
        .filter(agreement ? (b) => b.agreementId === agreement.id : budgetInPeriod)
        .filter(
          (b) =>
            !ALLOCATION_PLAN_ENABLED ||
            !input.engagementId ||
            b.engagementId === input.engagementId ||
            (!input.forClient && b.engagementId === null),
        );
      const billingRowsRaw = billingRowsRawAll.filter(inPeriod);

      const clientNames = yield* Effect.promise(async () => {
        const ids = [...new Set(reported.map((e) => e.clientOrganizationId))];
        const found = await Promise.all(ids.map((id) => organizations.get(id)));
        return new Map(ids.map((id, i) => [id, found[i]?.name ?? id]));
      });

      const billingRows = yield* Effect.promise(() =>
        Promise.all(
          billingRowsRaw
            .filter(
              (b) => subcontractorDao === undefined || b.payingDaoAccountId === subcontractorDao,
            )
            .flatMap((b) => {
              const payingDao = b.payingDaoAccountId ?? agencyDao;
              return payingDao ? [enrichWithChainStatus(db, b, payingDao)] : [];
            }),
        ),
      );

      const buildersResult = yield* Effect.promise(() =>
        plugins.builders(scope.pluginContext).listBuilders({ limit: 100 }),
      );
      const builderByNear = new Map(
        buildersResult.data.map((b) => [b.nearAccount, b.name ?? b.nearAccount]),
      );

      const paidBillings = billingRows.filter((b) => b.status === "Approved");

      const contributorStats = new Map<
        string,
        {
          nearAccount: string;
          name: string;
          billedRows: Array<{ tokenId: string; amount: string }>;
          count: number;
        }
      >();
      for (const b of paidBillings) {
        if (!b.nearAccount) continue;
        const existing = contributorStats.get(b.nearAccount) ?? {
          nearAccount: b.nearAccount,
          name: builderByNear.get(b.nearAccount) ?? b.nearAccount,
          billedRows: [] as Array<{ tokenId: string; amount: string }>,
          count: 0,
        };
        existing.billedRows.push({ tokenId: b.tokenId, amount: b.amount });
        existing.count += 1;
        contributorStats.set(b.nearAccount, existing);
      }

      const assignmentRows =
        projectIds.length > 0
          ? yield* Effect.promise(() =>
              db
                .select({
                  projectId: projectContributors.projectId,
                  nearAccount: projectContributors.nearAccount,
                })
                .from(projectContributors)
                .where(inArray(projectContributors.projectId, projectIds)),
            )
          : [];
      const buildersOf = (projectId: string) =>
        [
          ...new Set(
            assignmentRows
              .filter((r) => r.projectId === projectId)
              .map((r) => builderByNear.get(r.nearAccount) ?? r.nearAccount),
          ),
        ].sort((a, b) => a.localeCompare(b));

      const clientBreakdown: Array<{
        clientName: string;
        projectTitle: string;
        projectSlug: string;
        budgetByToken: ReturnType<typeof sumByToken>;
        spentByToken: ReturnType<typeof sumByToken>;
        builders: string[];
      }> = [];

      for (const engagement of reported) {
        const clientName =
          clientNames.get(engagement.clientOrganizationId) ?? engagement.clientOrganizationId;
        const pids = links
          .filter((l) => l.engagementId === engagement.id && projectIds.includes(l.projectId))
          .map((l) => l.projectId);
        for (const pid of pids) {
          const project = projectById.get(pid);
          clientBreakdown.push({
            clientName,
            projectTitle: project?.title ?? pid,
            projectSlug: project?.slug ?? pid,
            budgetByToken: sumByToken(
              budgetRows.filter(
                (b) =>
                  b.projectId === pid &&
                  (!ALLOCATION_PLAN_ENABLED || b.engagementId === engagement.id),
              ),
            ),
            spentByToken: sumByToken(paidBillings.filter((b) => b.projectId === pid)),
            builders: buildersOf(pid),
          });
        }
      }

      const projectBreakdown = projectIds
        .map((pid) => {
          const project = projectById.get(pid);
          return {
            projectTitle: project?.title ?? pid,
            projectSlug: project?.slug ?? pid,
            budgetByToken: sumByToken(budgetRows.filter((b) => b.projectId === pid)),
            billedByToken: sumByToken(paidBillings.filter((b) => b.projectId === pid)),
          };
        })
        .filter((p) =>
          [...p.budgetByToken, ...p.billedByToken].some((t) => BigInt(t.amount) !== 0n),
        )
        .sort((a, b) => a.projectTitle.localeCompare(b.projectTitle));

      const period =
        input.startDate && input.endDate
          ? `${input.startDate} – ${input.endDate}`
          : input.startDate
            ? `from ${input.startDate}`
            : input.endDate
              ? `through ${input.endDate}`
              : "all time";

      const scopedProject = input.projectId ? projectById.get(input.projectId) : undefined;

      return {
        project: scopedProject ? { title: scopedProject.title, slug: scopedProject.slug } : null,
        overview: {
          projectCount: projectIds.length,
          budgetByToken: sumByToken(budgetRows),
          billedByToken: sumByToken(paidBillings),
          period,
        },
        contributorStats: [...contributorStats.values()].map((s) => ({
          nearAccount: s.nearAccount,
          name: s.name,
          billedByToken: sumByToken(s.billedRows),
          billingCount: s.count,
        })),
        projectBreakdown,
        clientBreakdown,
        agreement: agreement
          ? {
              id: agreement.id,
              engagementId: agreement.engagementId,
              title: agreement.title,
              kind: agreement.kind,
              startDate: agreement.startDate,
              endDate: agreement.endDate,
              tokenId: agreement.tokenId,
              agreedAmount: agreement.agreedAmount,
              allocated: budgetRows
                .filter((b) => b.tokenId === agreement.tokenId)
                .reduce((sum, b) => sum + BigInt(b.amount), 0n)
                .toString(),
            }
          : null,
        notes: input.note ?? "",
        generatedAt: new Date().toISOString(),
      };
    });

  type Report = Effect.Effect.Success<ReturnType<typeof generate>>;

  const clientVisible = (
    engagement: { id: string; agencyOrganizationId: string },
    clientOrganizationId: string,
  ) =>
    and(
      eq(reportSnapshots.engagementId, engagement.id),
      or(
        eq(reportSnapshots.organizationId, clientOrganizationId),
        and(
          eq(reportSnapshots.organizationId, engagement.agencyOrganizationId),
          isNotNull(reportSnapshots.sharedAt),
        ),
      ),
    );

  function requireSharer(viewer: ReportViewer) {
    if (viewer.side !== "agency" || !viewer.canManage) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only an owner or admin can share reports with a client",
        data: { reason: "MANAGER_REQUIRED" },
      });
    }
  }

  async function shareableEngagement(viewer: ReportViewer, engagementId: string | null) {
    requireSharer(viewer);
    const [engagement] = engagementId
      ? await db.select().from(engagements).where(eq(engagements.id, engagementId)).limit(1)
      : [];
    if (
      !engagement ||
      engagement.kind !== "client" ||
      engagement.agencyOrganizationId !== viewer.organizationId ||
      !SHARED_STATUSES.includes(engagement.status)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Only a report for one client can be shared with that client",
        data: { reason: "NOT_CLIENT_REPORT" },
      });
    }
    return engagement;
  }

  async function tellClient(
    engagement: { id: string; agencyOrganizationId: string; clientOrganizationId: string },
    row: ReportSnapshotRow,
    actorUserId: string,
  ) {
    if (!notifications) return;
    try {
      const [agency, client] = await Promise.all([
        organizations.get(engagement.agencyOrganizationId),
        organizations.get(engagement.clientOrganizationId),
      ]);
      await notifications.notify({
        organizationId: engagement.clientOrganizationId,
        kind: "report_shared",
        payload: {
          agencyName: agency?.name ?? engagement.agencyOrganizationId,
          clientName: client?.name ?? engagement.clientOrganizationId,
          engagementId: engagement.id,
          period: periodOf(row),
        },
        link: `/client/${engagement.id}/reports?report=${row.id}`,
        excludeUserId: actorUserId,
      });
    } catch (err) {
      console.warn("[API] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    generate,

    generateSaved: (scope: AgencyScope, input: ReportInput, owner: ReportOwner) =>
      Effect.gen(function* () {
        const report = yield* generate(scope, input);
        const id = crypto.randomUUID();
        yield* Effect.promise(() =>
          db.insert(reportSnapshots).values({
            id,
            organizationId: owner.organizationId,
            engagementId: report.agreement?.engagementId ?? input.engagementId ?? null,
            generatedByUserId: owner.userId,
            startDate: report.agreement?.startDate ?? input.startDate ?? null,
            endDate: report.agreement?.endDate ?? input.endDate ?? null,
            note: input.note?.trim() || null,
            payload: JSON.stringify(report),
          }),
        );
        return { ...report, id };
      }),

    listSaved: async (
      organizationId: string,
      filter: { engagementId?: string } = {},
      viewer?: ReportViewer,
    ) => {
      const rows = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.organizationId, organizationId),
            filter.engagementId ? eq(reportSnapshots.engagementId, filter.engagementId) : undefined,
          ),
        )
        .orderBy(desc(reportSnapshots.createdAt), desc(reportSnapshots.id))
        .limit(200);
      return { data: rows.map((row) => summaryOf(row, viewer)) };
    },

    getSaved: async (
      organizationId: string,
      id: string,
      filter: { engagementId?: string } = {},
      viewer?: ReportViewer,
    ) => {
      const [row] = await db
        .select()
        .from(reportSnapshots)
        .where(and(eq(reportSnapshots.id, id), eq(reportSnapshots.organizationId, organizationId)))
        .limit(1);
      if (!row || (filter.engagementId && row.engagementId !== filter.engagementId)) {
        throw reportNotFound();
      }
      return { ...summaryOf(row, viewer), report: JSON.parse(row.payload) as Report };
    },

    listForClient: async (
      engagement: { id: string; agencyOrganizationId: string },
      viewer: ReportViewer,
    ) => {
      const rows = await db
        .select()
        .from(reportSnapshots)
        .where(clientVisible(engagement, viewer.organizationId))
        .orderBy(desc(reportSnapshots.createdAt), desc(reportSnapshots.id))
        .limit(200);
      return { data: rows.map((row) => summaryOf(row, viewer)) };
    },

    getForClient: async (
      engagement: { id: string; agencyOrganizationId: string },
      id: string,
      viewer: ReportViewer,
    ) => {
      const [row] = await db
        .select()
        .from(reportSnapshots)
        .where(and(eq(reportSnapshots.id, id), clientVisible(engagement, viewer.organizationId)))
        .limit(1);
      if (!row) throw reportNotFound();
      return {
        ...summaryOf(row, viewer),
        report: clientSafe(JSON.parse(row.payload) as Report),
      };
    },

    deleteSaved: async (
      viewer: ReportViewer,
      id: string,
      filter: { engagementId?: string } = {},
    ) => {
      const [row] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.organizationId, viewer.organizationId),
          ),
        )
        .limit(1);
      if (!row || (filter.engagementId && row.engagementId !== filter.engagementId)) {
        throw reportNotFound();
      }
      if (!summaryOf(row, viewer).canDelete) {
        throw new ORPCError("FORBIDDEN", {
          message: "Only the person who saved a report or an owner or admin can delete it",
          data: { reason: "NOT_REPORT_AUTHOR" },
        });
      }
      await db.delete(reportSnapshots).where(eq(reportSnapshots.id, row.id));
      return { deleted: true as const };
    },

    assertShareable: shareableEngagement,

    setShared: async (viewer: ReportViewer, id: string, shared: boolean) => {
      requireSharer(viewer);
      const [row] = await db
        .select()
        .from(reportSnapshots)
        .where(
          and(
            eq(reportSnapshots.id, id),
            eq(reportSnapshots.organizationId, viewer.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw reportNotFound();
      if (!shared) {
        const [updated] = await db
          .update(reportSnapshots)
          .set({ sharedAt: null, sharedByUserId: null })
          .where(eq(reportSnapshots.id, row.id))
          .returning();
        return summaryOf(updated!, viewer);
      }
      const engagement = await shareableEngagement(viewer, row.engagementId);
      const wasShared = row.sharedAt !== null;
      const [updated] = await db
        .update(reportSnapshots)
        .set({ sharedAt: row.sharedAt ?? new Date(), sharedByUserId: viewer.userId })
        .where(eq(reportSnapshots.id, row.id))
        .returning();
      if (!wasShared) await tellClient(engagement, updated!, viewer.userId);
      return summaryOf(updated!, viewer);
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
