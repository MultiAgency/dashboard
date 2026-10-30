import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { buildScoped, createPlugin, type PluginInitializeInput } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { type CallerContext, callerOf, isTrustedIdeaCreate } from "./lib/caller";
import { ContextSchema, runEffect } from "./lib/context";
import { ProjectService, ProjectServiceLive } from "./services/projects";

const variables = z.object({});

const secrets = z.object({
  PROJECTS_DATABASE_URL: z.string().default("pglite:.bos/projects/:memory:"),
});

const initializeServices = (config: PluginInitializeInput<typeof variables, typeof secrets>) =>
  Effect.gen(function* () {
    const project = yield* buildScoped(
      ProjectService,
      ProjectServiceLive.pipe(Layer.provide(DatabaseLive(config.secrets.PROJECTS_DATABASE_URL))),
    );
    console.log("[Projects] Services Initialized");
    return { project };
  });

type ProjectsServicesShape = Effect.Success<ReturnType<typeof initializeServices>>;

class ProjectsServices extends Context.Service<ProjectsServices, ProjectsServicesShape>()(
  "ProjectsServices",
) {}

export default createPlugin({
  variables,

  secrets,

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const services = yield* initializeServices(config);
      yield* Effect.addFinalizer(() => Effect.log("[Projects] Shutdown"));
      return Layer.succeed(ProjectsServices, services);
    }),

  createRouter: (builder) => {
    const auth = createAuthMiddleware(builder);
    const caller = (context: unknown) => callerOf(context as CallerContext);

    const rethrowNotFound =
      (notFound: () => Error) =>
      (err: { code?: string }): never => {
        if (err?.code === "NOT_FOUND") throw notFound();
        throw err;
      };

    return {
      listProjects: builder.listProjects.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        return runEffect(services.project.listProjects(input, caller(context)));
      }),

      getProject: builder.getProject.handler(async ({ input, errors, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
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
        const services = Context.get(context["effect/context"], ProjectsServices);
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

      createProject: builder.createProject.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        const signedIn = Boolean(context.user && context.userId);
        if (!signedIn && !isTrustedIdeaCreate(context as CallerContext, input)) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { hint: "Sign in to continue" },
          });
        }
        return runEffect(services.project.createProject(input, caller(context)));
      }),

      updateProject: builder.updateProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const services = Context.get(context["effect/context"], ProjectsServices);
          return runEffect(services.project.updateProject(input.id, input, caller(context))).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              }),
            ),
          );
        }),

      deleteProject: builder.deleteProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const services = Context.get(context["effect/context"], ProjectsServices);
          return runEffect(services.project.deleteProject(input.id, caller(context))).catch(
            rethrowNotFound(() =>
              errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              }),
            ),
          );
        }),

      listProjectApps: builder.listProjectApps.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        const result = await runEffect(services.project.listProjectApps(input.projectId));
        return { data: result };
      }),

      linkAppToProject: builder.linkAppToProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const services = Context.get(context["effect/context"], ProjectsServices);
          return runEffect(
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
          );
        }),

      unlinkAppFromProject: builder.unlinkAppFromProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const services = Context.get(context["effect/context"], ProjectsServices);
          return runEffect(
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
          );
        }),

      listProjectsForApp: builder.listProjectsForApp.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        const result = await runEffect(
          services.project.listProjectsForApp(input.accountId, input.domain, caller(context)),
        );
        return { data: result };
      }),

      listMentions: builder.listMentions.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        const result = await runEffect(services.project.listMentions(input.id, caller(context)));
        return { data: result };
      }),

      listMentionedBy: builder.listMentionedBy.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], ProjectsServices);
        const result = await runEffect(services.project.listMentionedBy(input.id, caller(context)));
        return { data: result };
      }),
    };
  },
});
