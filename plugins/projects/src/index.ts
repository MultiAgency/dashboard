import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
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

    const getAlternateOwnerId = (context: any) =>
      context.near?.primaryAccountId && context.near?.primaryAccountId !== context.userId
        ? context.userId
        : undefined;

    const getOrgInfo = (context: any) => ({
      orgId: context.organization?.activeOrganizationId ?? context.organizationId,
      orgRole: context.organization?.member?.role,
    });

    return {
      listProjects: builder.listProjects.handler(async ({ input, context }) => {
        const ctx = context as any;
        const ownerId = ctx.near?.primaryAccountId ?? ctx.userId;
        const { orgId, orgRole } = getOrgInfo(ctx);
        return runEffect(
          services.project.listProjects(input, ownerId, getAlternateOwnerId(ctx), orgId, orgRole),
        );
      }),

      getProject: builder.getProject.handler(async ({ input, errors, context }) => {
        const ctx = context as any;
        const ownerId = ctx.near?.primaryAccountId ?? ctx.userId;
        const { orgId, orgRole } = getOrgInfo(ctx);
        const result = await runEffect(
          services.project.getProject(input.id, ownerId, getAlternateOwnerId(ctx), orgId, orgRole),
        );
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Project not found",
            data: { resource: "project", resourceId: input.id },
          });
        }
        return { data: result };
      }),

      getProjectBySlug: builder.getProjectBySlug.handler(async ({ input, errors, context }) => {
        const ctx = context as any;
        const ownerId = ctx.near?.primaryAccountId ?? ctx.userId;
        const { orgId, orgRole } = getOrgInfo(ctx);
        const result = await runEffect(
          services.project.getProjectBySlug(
            input.slug,
            ownerId,
            getAlternateOwnerId(ctx),
            orgId,
            orgRole,
          ),
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
        .handler(async ({ input, context }) => {
          const ctx = context as any;
          const ownerId = ctx.near?.primaryAccountId ?? ctx.userId;
          const { orgId, orgRole } = getOrgInfo(ctx);
          return runEffect(
            services.project.createProject(
              input,
              ownerId,
              ctx.user.role,
              getAlternateOwnerId(ctx),
              orgId,
              orgRole,
            ),
          );
        }),

      updateProject: builder.updateProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const ctx = context as any;
          const { orgId, orgRole } = getOrgInfo(ctx);
          return runEffect(
            services.project.updateProject(
              input.id,
              input,
              ctx.near?.primaryAccountId ?? ctx.userId,
              ctx.user.role,
              getAlternateOwnerId(ctx),
              orgId,
              orgRole,
            ),
          ).catch((err) => {
            if (err?.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              });
            }
            throw err;
          });
        }),

      deleteProject: builder.deleteProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const ctx = context as any;
          const { orgId, orgRole } = getOrgInfo(ctx);
          return runEffect(
            services.project.deleteProject(
              input.id,
              ctx.near?.primaryAccountId ?? ctx.userId,
              ctx.user.role,
              getAlternateOwnerId(ctx),
              orgId,
              orgRole,
            ),
          ).catch((err) => {
            if (err?.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.id },
              });
            }
            throw err;
          });
        }),

      listProjectApps: builder.listProjectApps.handler(async ({ input }) => {
        const result = await runEffect(services.project.listProjectApps(input.projectId));
        return { data: result };
      }),

      linkAppToProject: builder.linkAppToProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const ctx = context as any;
          const { orgId, orgRole } = getOrgInfo(ctx);
          return runEffect(
            services.project.linkAppToProject(
              input.projectId,
              input.accountId,
              input.domain,
              ctx.near?.primaryAccountId ?? ctx.userId,
              ctx.user.role,
              getAlternateOwnerId(ctx),
              orgId,
              orgRole,
            ),
          ).catch((err) => {
            if (err?.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Project not found",
                data: { resource: "project", resourceId: input.projectId },
              });
            }
            throw err;
          });
        }),

      unlinkAppFromProject: builder.unlinkAppFromProject
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const ctx = context as any;
          const { orgId, orgRole } = getOrgInfo(ctx);
          return runEffect(
            services.project.unlinkAppFromProject(
              input.projectId,
              input.accountId,
              input.domain,
              ctx.near?.primaryAccountId ?? ctx.userId,
              ctx.user.role,
              getAlternateOwnerId(ctx),
              orgId,
              orgRole,
            ),
          ).catch((err) => {
            if (err?.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Project or app not found",
                data: { resource: "project-app" },
              });
            }
            throw err;
          });
        }),

      listProjectsForApp: builder.listProjectsForApp.handler(async ({ input, context }) => {
        const ctx = context as any;
        const { orgId, orgRole } = getOrgInfo(ctx);
        const result = await runEffect(
          services.project.listProjectsForApp(
            input.accountId,
            input.domain,
            ctx.near?.primaryAccountId ?? ctx.userId,
            getAlternateOwnerId(ctx),
            orgId,
            orgRole,
          ),
        );
        return { data: result };
      }),

      listMentions: builder.listMentions.handler(async ({ input, context }) => {
        const ctx = context as any;
        const { orgId, orgRole } = getOrgInfo(ctx);
        const result = await runEffect(
          services.project.listMentions(
            input.id,
            ctx.near?.primaryAccountId ?? ctx.userId,
            getAlternateOwnerId(ctx),
            orgId,
            orgRole,
          ),
        );
        return { data: result };
      }),

      listMentionedBy: builder.listMentionedBy.handler(async ({ input, context }) => {
        const ctx = context as any;
        const { orgId, orgRole } = getOrgInfo(ctx);
        const result = await runEffect(
          services.project.listMentionedBy(
            input.id,
            ctx.near?.primaryAccountId ?? ctx.userId,
            getAlternateOwnerId(ctx),
            orgId,
            orgRole,
          ),
        );
        return { data: result };
      }),
    };
  },
});
