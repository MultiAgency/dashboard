import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type EngagementRow, engagementProjects, type IdeaRow, ideas } from "../db/schema";
import { runEffect } from "../lib/context";
import type { OrganizationDirectory, PluginContext } from "../lib/organizations";
import type { AgencyService } from "./agency";
import {
  badRequest,
  engagementNotFound,
  loadEngagement,
  readableEngagement,
} from "./engagement-lookup";
import type { NotificationKind, NotificationsService } from "./notifications";
import type { AgencyScope, OrganizationScope } from "./organization-access";
import type { Project, ProjectDirectory } from "./project-directory";

export type IdeaResult = {
  id: string;
  slug: string;
  title: string;
  kind: Project["kind"];
  shared: boolean;
};

export type IdeaView = {
  id: string;
  engagementId: string;
  slug: string;
  title: string;
  description: string | null;
  status: IdeaRow["status"];
  submittedByUserId: string;
  result: IdeaResult | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type AcceptIdeaInput = {
  id: string;
  kind: "project" | "scope";
  title: string;
  slug: string;
  parentSlug?: string;
  repository?: string;
  share: boolean;
};

const SLUG_ATTEMPTS = 5;

const ideaNotFound = () => new ORPCError("NOT_FOUND", { message: "Idea not found" });

function isSlugTaken(err: unknown): boolean {
  const data = (err as { data?: { validationErrors?: Array<{ code?: string }> } } | null)?.data;
  return data?.validationErrors?.some((e) => e.code === "SLUG_TAKEN") ?? false;
}

function slugBase(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return base || "idea";
}

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

export function createIdeasService(deps: {
  db: Database;
  agency: AgencyService;
  directory: ProjectDirectory;
  readScopeOfAgency: (context: PluginContext, agencyOrganizationId: string) => Promise<AgencyScope>;
  engagements: {
    share(
      scope: OrganizationScope,
      input: { engagementId: string; projectId: string },
    ): Promise<unknown>;
  };
  notifications: NotificationsService;
  organizations: Pick<OrganizationDirectory, "get">;
  slugSuffix?: () => string;
  now?: () => Date;
}) {
  const { db, agency, directory, notifications, organizations } = deps;
  const slugSuffix = deps.slugSuffix ?? randomSuffix;
  const now = deps.now ?? (() => new Date());

  const userIdOf = (scope: OrganizationScope) => scope.pluginContext.userId ?? scope.actorId;

  function requireActive(row: EngagementRow, message: string) {
    if (row.status !== "active") throw badRequest("NOT_ACTIVE", message);
  }

  async function requireAgencyIdea(scope: OrganizationScope, id: string) {
    const [idea] = await db.select().from(ideas).where(eq(ideas.projectId, id)).limit(1);
    const row = idea ? await loadEngagement(db, idea.engagementId) : null;
    if (!idea || !row || row.agencyOrganizationId !== scope.organizationId) throw ideaNotFound();
    requireActive(
      row,
      "An ended Engagement is read-only history; its ideas can no longer be decided.",
    );
    if (idea.status !== "new") {
      throw badRequest("IDEA_DECIDED", "This idea was already accepted or declined.");
    }
    return { idea, row };
  }

  async function readScopeFor(
    scope: OrganizationScope,
    row: EngagementRow,
    side: "agency" | "client",
  ) {
    return side === "agency"
      ? scope
      : deps.readScopeOfAgency(scope.pluginContext, row.agencyOrganizationId);
  }

  async function sharedIds(engagementId: string): Promise<Set<string>> {
    const rows = await db
      .select({ projectId: engagementProjects.projectId })
      .from(engagementProjects)
      .where(eq(engagementProjects.engagementId, engagementId));
    return new Set(rows.map((r) => r.projectId));
  }

  async function views(
    readScope: AgencyScope,
    rows: IdeaRow[],
    engagementId: string,
    side: "agency" | "client",
  ): Promise<IdeaView[]> {
    if (rows.length === 0) return [];
    const [projects, shared] = await Promise.all([
      directory.forAgency(readScope).list(),
      sharedIds(engagementId),
    ]);
    const byId = new Map(projects.map((p) => [p.id, p]));
    return rows.flatMap((row) => {
      const project = byId.get(row.projectId);
      if (!project) return [];
      const resultProject = row.resultProjectId ? byId.get(row.resultProjectId) : undefined;
      const isShared = resultProject ? shared.has(resultProject.id) : false;
      const result =
        resultProject && (side === "agency" || isShared)
          ? {
              id: resultProject.id,
              slug: resultProject.slug,
              title: resultProject.title,
              kind: resultProject.kind,
              shared: isShared,
            }
          : null;
      return [
        {
          id: row.projectId,
          engagementId: row.engagementId,
          slug: project.slug,
          title: project.title,
          description: project.description,
          status: row.status,
          submittedByUserId: row.submittedByUserId,
          result,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
        },
      ];
    });
  }

  async function viewOf(scope: OrganizationScope, row: EngagementRow, ideaId: string) {
    const [idea] = await db.select().from(ideas).where(eq(ideas.projectId, ideaId)).limit(1);
    const side = row.agencyOrganizationId === scope.organizationId ? "agency" : "client";
    const [view] = await views(
      await readScopeFor(scope, row, side),
      idea ? [idea] : [],
      row.id,
      side,
    );
    if (!view) throw ideaNotFound();
    return view;
  }

  async function tell(
    scope: OrganizationScope,
    row: EngagementRow,
    kind: NotificationKind,
    payload: Record<string, string>,
    options: { toClient: boolean; alsoNotifyUserIds?: string[] },
  ) {
    const [agencyOrg, clientOrg] = await Promise.all([
      organizations.get(row.agencyOrganizationId),
      organizations.get(row.clientOrganizationId),
    ]);
    try {
      await notifications.notify({
        organizationId: options.toClient ? row.clientOrganizationId : row.agencyOrganizationId,
        kind,
        payload: {
          agencyName: agencyOrg?.name ?? row.agencyOrganizationId,
          clientName: clientOrg?.name ?? row.clientOrganizationId,
          engagementId: row.id,
          ...payload,
        },
        link: options.toClient
          ? `/client/${row.id}/ideas`
          : `/admin/engagements/${row.id}?tab=ideas`,
        excludeUserId: userIdOf(scope),
        alsoNotifyUserIds: options.alsoNotifyUserIds,
      });
    } catch (err) {
      console.warn("[API] notification failed:", err instanceof Error ? err.message : err);
    }
  }

  async function createIdeaProject(
    agencyScope: AgencyScope,
    input: { title: string; description?: string },
  ): Promise<Project> {
    const base = slugBase(input.title);
    const trustedScope = {
      ...agencyScope,
      pluginContext: { ...agencyScope.pluginContext, trusted: true },
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const { project } = await runEffect(
          agency.createProject(trustedScope, {
            kind: "idea",
            visibility: "private",
            title: input.title,
            slug: `${base}-${slugSuffix()}`,
            description: input.description,
          }),
        );
        return project;
      } catch (err) {
        if (!isSlugTaken(err) || attempt >= SLUG_ATTEMPTS) throw err;
      }
    }
  }

  return {
    submit: async (
      scope: OrganizationScope,
      input: { engagementId: string; title: string; description?: string },
    ): Promise<IdeaView> => {
      const row = await loadEngagement(db, input.engagementId);
      if (!row || row.clientOrganizationId !== scope.organizationId || row.kind !== "client") {
        throw engagementNotFound();
      }
      requireActive(row, "Ideas can only be submitted through an active Engagement.");
      const agencyScope = await deps.readScopeOfAgency(
        scope.pluginContext,
        row.agencyOrganizationId,
      );
      const project = await createIdeaProject(agencyScope, {
        title: input.title.trim(),
        description: input.description?.trim() || undefined,
      });
      await db.insert(ideas).values({
        projectId: project.id,
        engagementId: row.id,
        submittedByUserId: userIdOf(scope),
      });
      await tell(scope, row, "idea_submitted", { ideaTitle: project.title }, { toClient: false });
      return viewOf(scope, row, project.id);
    },

    list: async (scope: OrganizationScope, input: { engagementId: string }) => {
      const { row, side } = await readableEngagement(db, scope, input.engagementId, {
        clientKind: "client",
      });
      const rows = await db
        .select()
        .from(ideas)
        .where(eq(ideas.engagementId, row.id))
        .orderBy(desc(ideas.createdAt), desc(ideas.projectId));
      return { data: await views(await readScopeFor(scope, row, side), rows, row.id, side) };
    },

    accept: async (scope: OrganizationScope, input: AcceptIdeaInput): Promise<IdeaView> => {
      const { idea, row } = await requireAgencyIdea(scope, input.id);
      if (input.kind === "project" && !input.repository) {
        throw badRequest("REPOSITORY_REQUIRED", "Projects require a repository URL");
      }
      const [claimed] = await db
        .update(ideas)
        .set({
          status: "accepted",
          decidedByUserId: userIdOf(scope),
          decidedAt: now(),
          updatedAt: now(),
        })
        .where(and(eq(ideas.projectId, idea.projectId), eq(ideas.status, "new")))
        .returning();
      if (!claimed) throw badRequest("IDEA_DECIDED", "This idea was already accepted or declined.");
      let created: Project;
      try {
        const source = await directory.forAgency(scope).require(idea.projectId);
        created = (
          await runEffect(
            agency.createProject(scope, {
              kind: input.kind,
              title: input.title,
              slug: input.slug,
              parentSlug: input.parentSlug,
              repository: input.kind === "project" ? input.repository : undefined,
              description: source.description ?? undefined,
              visibility: "private",
            }),
          )
        ).project;
      } catch (err) {
        await db
          .update(ideas)
          .set({ status: "new", decidedByUserId: null, decidedAt: null, updatedAt: now() })
          .where(eq(ideas.projectId, idea.projectId));
        throw err;
      }
      await db
        .update(ideas)
        .set({ resultProjectId: created.id, updatedAt: now() })
        .where(eq(ideas.projectId, idea.projectId));
      if (input.share) {
        await deps.engagements.share(scope, { engagementId: row.id, projectId: created.id });
      }
      const view = await viewOf(scope, row, idea.projectId);
      await tell(
        scope,
        row,
        "idea_accepted",
        { ideaTitle: view.title, resultTitle: created.title },
        { toClient: true, alsoNotifyUserIds: [idea.submittedByUserId] },
      );
      return view;
    },

    decline: async (scope: OrganizationScope, input: { id: string }): Promise<IdeaView> => {
      const { idea, row } = await requireAgencyIdea(scope, input.id);
      const [declined] = await db
        .update(ideas)
        .set({
          status: "declined",
          decidedByUserId: userIdOf(scope),
          decidedAt: now(),
          updatedAt: now(),
        })
        .where(and(eq(ideas.projectId, idea.projectId), eq(ideas.status, "new")))
        .returning();
      if (!declined)
        throw badRequest("IDEA_DECIDED", "This idea was already accepted or declined.");
      const view = await viewOf(scope, row, idea.projectId);
      await tell(
        scope,
        row,
        "idea_declined",
        { ideaTitle: view.title },
        { toClient: true, alsoNotifyUserIds: [idea.submittedByUserId] },
      );
      return view;
    },
  };
}

export type IdeasService = ReturnType<typeof createIdeasService>;
