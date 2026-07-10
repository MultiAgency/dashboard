import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { ProjectService, ProjectServiceLive } from "./services/projects";
import { createAuthMiddleware } from "./lib/auth";
import { runEffect, ContextSchema } from "./lib/context";

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    PROJECTS_DATABASE_URL: z.string().default("pglite:.bos/projects/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const Database = DatabaseLive(config.secrets.PROJECTS_DATABASE_URL);
      const ProjectServices = ProjectServiceLive.pipe(Layer.provide(Database));
      const project = yield* Effect.provide(ProjectService, ProjectServices);
      console.log("[Projects] Services Initialized");
      return { project };
    }),

  shutdown: () => Effect.log("[Projects] Shutdown"),

  createRouter: (services, builder) => {
    const auth = createAuthMiddleware(builder);

    const getAlternateOwnerId = (context: { userId?: string; near?.primaryAccountId?: string }) =>
      context.near?.primaryAccountId && context.near?.primaryAccountId !== context.userId
        ? context.userId
        : undefined;

    const getOrgInfo = (context: {
      organization?: { activeOrganizationId?: string; member?: { role?: string } };
      organizationId?: string;
    }) => ({
      orgId: context.organization?.activeOrganizationId ?? context.organizationId,
      orgRole: context.organization?.member?.role,
    });

    return {
      listProjects: builder.listProjects.handler(async ({ input, context }) => {
        const ownerId = context.near?.primaryAccountId ?? context.userId;
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.listProjects(input, ownerId, getAlternateOwnerId(context), orgId, orgRole),
        );
      }),

      getProject: builder.getProject.handler(async ({ input, errors, context }) => {
        const ownerId = context.near?.primaryAccountId ?? context.userId;
        const { orgId, orgRole } = getOrgInfo(context);
        const result = await runEffect(
          services.project.getProject(input.id, ownerId, getAlternateOwnerId(context), orgId, orgRole),
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
        const ownerId = context.near?.primaryAccountId ?? context.userId;
        const { orgId, orgRole } = getOrgInfo(context);
        const result = await runEffect(
          services.project.getProjectBySlug(input.slug, ownerId, getAlternateOwnerId(context), orgId, orgRole),
        );
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Project not found",
            data: { resource: "project", resourceId: input.slug },
          });
        }
        return { data: result };
      }),

      createProject: builder.createProject.use(auth.requireAuth).handler(async ({ input, context }) => {
        const ownerId = context.near?.primaryAccountId ?? context.userId!;
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.createProject(input, ownerId, context.user!.role, getAlternateOwnerId(context), orgId, orgRole),
        );
      }),

      updateProject: builder.updateProject.use(auth.requireAuth).handler(async ({ input, context, errors }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.updateProject(
            input.id,
            input,
            context.near?.primaryAccountId ?? context.userId!,
            context.user!.role,
            getAlternateOwnerId(context),
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

      deleteProject: builder.deleteProject.use(auth.requireAuth).handler(async ({ input, context, errors }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.deleteProject(
            input.id,
            context.near?.primaryAccountId ?? context.userId!,
            context.user!.role,
            getAlternateOwnerId(context),
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

      linkAppToProject: builder.linkAppToProject.use(auth.requireAuth).handler(async ({ input, context, errors }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.linkAppToProject(
            input.projectId,
            input.accountId,
            input.domain,
            context.near?.primaryAccountId ?? context.userId!,
            context.user!.role,
            getAlternateOwnerId(context),
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

      unlinkAppFromProject: builder.unlinkAppFromProject.use(auth.requireAuth).handler(async ({ input, context, errors }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        return runEffect(
          services.project.unlinkAppFromProject(
            input.projectId,
            input.accountId,
            input.domain,
            context.near?.primaryAccountId ?? context.userId!,
            context.user!.role,
            getAlternateOwnerId(context),
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
        const { orgId, orgRole } = getOrgInfo(context);
        const result = await runEffect(
          services.project.listProjectsForApp(
            input.accountId,
            input.domain,
            context.near?.primaryAccountId ?? context.userId,
            getAlternateOwnerId(context),
            orgId,
            orgRole,
          ),
        );
        return { data: result };
      }),

      listMentions: builder.listMentions.handler(async ({ input, context }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        const result = await runEffect(
          services.project.listMentions(
            input.id,
            context.near?.primaryAccountId ?? context.userId,
            getAlternateOwnerId(context),
            orgId,
            orgRole,
          ),
        );
        return { data: result } as any;
      }),

      listMentionedBy: builder.listMentionedBy.handler(async ({ input, context }) => {
        const { orgId, orgRole } = getOrgInfo(context);
        const result = await runEffect(
          services.project.listMentionedBy(
            input.id,
            context.near?.primaryAccountId ?? context.userId,
            getAlternateOwnerId(context),
            orgId,
            orgRole,
          ),
        );
        return { data: result } as any;
      }),
    };
  },
});
