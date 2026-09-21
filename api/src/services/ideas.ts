import { eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { engagementIdeas } from "../db/schema";
import type { OrgScope, PluginContext } from "../lib/agency-scope";
import type { EngagementsService } from "./engagements";

export type IdeaProject = {
  id: string;
  title: string;
  slug: string;
  status: string;
  kind: string;
  description: string | null;
  organizationId: string | null;
};

export type IdeaProjects = {
  create(
    context: PluginContext,
    input: {
      kind: "idea";
      title: string;
      slug: string;
      content: string;
      description?: string;
      visibility: "private";
      organizationId: string;
    },
  ): Promise<IdeaProject>;
  get(context: PluginContext, id: string): Promise<IdeaProject | null>;
};

function slugFor(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "idea";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createIdeasService(
  db: Database,
  engagements: EngagementsService,
  projects: IdeaProjects,
) {
  return {
    submit: (
      scope: OrgScope,
      input: { engagementId: string; title: string; description?: string },
    ) =>
      Effect.gen(function* () {
        const engagement = yield* engagements.asClient(scope, input.engagementId);
        if (engagement.status !== "active") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Ideas can be submitted on an active Engagement.",
            }),
          );
        }
        const title = input.title.trim();
        const description = input.description?.trim() || undefined;
        const created = yield* Effect.promise(() =>
          projects.create(scope.pluginContext, {
            kind: "idea",
            title,
            slug: slugFor(title),
            content: description || title,
            description,
            visibility: "private",
            organizationId: engagement.agency.organizationId,
          }),
        );
        yield* Effect.promise(() =>
          db.insert(engagementIdeas).values({
            engagementId: engagement.id,
            projectId: created.id,
            createdBy: scope.actorId,
          }),
        );
        return {
          idea: {
            projectId: created.id,
            title: created.title,
            slug: created.slug,
            status: created.status,
            description: created.description,
            organizationId: created.organizationId,
            createdBy: scope.actorId,
          },
        };
      }),

    list: (scope: OrgScope, engagementId: string) =>
      Effect.gen(function* () {
        yield* engagements.forParty(scope, engagementId);
        const rows = yield* Effect.promise(() =>
          db.select().from(engagementIdeas).where(eq(engagementIdeas.engagementId, engagementId)),
        );
        const data = yield* Effect.promise(() =>
          Promise.all(
            rows.map(async (row) => {
              const project = await projects.get(scope.pluginContext, row.projectId);
              return {
                projectId: row.projectId,
                title: project?.title ?? row.projectId,
                slug: project?.slug ?? row.projectId,
                status: project?.status ?? "active",
                description: project?.description ?? null,
                organizationId: project?.organizationId ?? null,
                createdBy: row.createdBy,
                createdAt: row.createdAt,
              };
            }),
          ),
        );
        return { data };
      }),
  };
}

export type IdeasService = ReturnType<typeof createIdeasService>;
