import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { type CallerContext, callerOf } from "./lib/caller";
import { ContextSchema, runEffect } from "./lib/context";
import { ProjectService, ProjectServiceLive } from "./services/projects";

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    PROJECTS_DATABASE_URL: z.string().default("pglite:.bos/projects/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const project = yield* tools.buildService(
        ProjectService,
        ProjectServiceLive.pipe(Layer.provide(DatabaseLive(config.secrets.PROJECTS_DATABASE_URL))),
      );
      console.log("[Projects] Services Initialized");
      return { project };
    }),

  shutdown: () => Effect.log("[Projects] Shutdown"),

  createRouter: (services, builder) => {
    const auth = createAuthMiddleware(builder);
    const caller = (context: unknown) => callerOf(context as CallerContext);

    const rethrowNotFound =
      (notFound: () => Error) =>
      (err: { code?: string }): never => {
        if (err?.code === "NOT_FOUND") throw notFound();
        throw err;
      };

    return {
      listProjects: builder.listProjects.handler(async ({ input, context }) =>
        runEffect(services.project.listProjects(input, caller(context))),
      ),

      getProject: builder.getProject.handler(async ({ input, errors, context }) => {
        const result = await runEffect(services.project.getProject(input.id, caller(context)));
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Project not found",
            data: { resource: "project", resourceId: input.id },
          });
        }
        return { data: result };
      }),

      getProjectBySlug: builder.getProjectBySlug.handler(async ({ input, errors, context }) => {
        const result = await runEffect(
          services.project.getProjectBySlug(input.slug, caller(context)),
        );
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Project not found",
            data: { resource: "project", resourceId: input.slug },
          });
        }
        return { data: result };
      }),

      createProject: builder.createProject
        .use(auth.requireAuth)
        .handler(async ({ input, context }) =>
          runEffect(services.project.createProject(input, caller(context))),
        ),

      updateProject: builder.updateProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) =>
          runEffect(services.project.updateProject(input.id, input, caller(context))).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              }),
            ),
          ),
        ),

      deleteProject: builder.deleteProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) =>
          runEffect(services.project.deleteProject(input.id, caller(context))).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              }),
            ),
          ),
        ),

      listProjectApps: builder.listProjectApps.handler(async ({ input }) => {
        const result = await runEffect(services.project.listProjectApps(input.projectId));
        return { data: result };
      }),

      linkAppToProject: builder.linkAppToProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) =>
          runEffect(
            services.project.linkAppToProject(
              input.projectId,
              input.accountId,
              input.domain,
              caller(context),
            ),
          ).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.projectId },
              }),
            ),
          ),
        ),

      unlinkAppFromProject: builder.unlinkAppFromProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) =>
          runEffect(
            services.project.unlinkAppFromProject(
              input.projectId,
              input.accountId,
              input.domain,
              caller(context),
            ),
          ).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project or app not found",
                data: { resource: "project-app" },
              }),
            ),
          ),
        ),

      listProjectsForApp: builder.listProjectsForApp.handler(async ({ input, context }) => {
        const result = await runEffect(
          services.project.listProjectsForApp(input.accountId, input.domain, caller(context)),
        );
        return { data: result };
      }),

      listMentions: builder.listMentions.handler(async ({ input, context }) => {
        const result = await runEffect(services.project.listMentions(input.id, caller(context)));
        return { data: result };
      }),

      listMentionedBy: builder.listMentionedBy.handler(async ({ input, context }) => {
        const result = await runEffect(services.project.listMentionedBy(input.id, caller(context)));
        return { data: result };
      }),
    };
  },
});
