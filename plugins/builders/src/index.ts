import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { BuilderService, BuilderServiceLive } from "./services/builders";
import { runEffect, ContextSchema } from "./lib/context";
import { createAuthMiddleware } from "./lib/auth";

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    BUILDERS_DATABASE_URL: z.string().default("pglite:.bos/builders/:memory:"),
  }),

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const Database = DatabaseLive(config.secrets.BUILDERS_DATABASE_URL);
      const BuilderServices = BuilderServiceLive.pipe(Layer.provide(Database));
      const builder = yield* Effect.provide(BuilderService, BuilderServices);

      console.log("[Builders] Services Initialized");
      return { builder };
    }),

  shutdown: () => Effect.log("[Builders] Shutdown"),

  createRouter: (services, builder) => {
    const auth = createAuthMiddleware(builder);

    return {
      listBuilders: builder.listBuilders.handler(async ({ input }) => {
        return await runEffect(services.builder.listBuilders(input));
      }),

      getBuilder: builder.getBuilder.handler(async ({ input, errors }) => {
        const result = await runEffect(services.builder.getBuilder(input.nearAccount));
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Builder not found",
            data: { resource: "builder", resourceId: input.nearAccount },
          });
        }
        return { data: result };
      }),

      getMyBuilderProfile: builder.getMyBuilderProfile
        .use(auth.requireAuth)
        .handler(async ({ context }) => {
          const result = await runEffect(
            services.builder.getBuilderByUserId(context.userId, context.walletAddress),
          );
          return { data: result };
        }),

      createBuilder: builder.createBuilder.use(auth.requireAdmin).handler(async ({ input }) => {
        const result = await runEffect(services.builder.createBuilder(input));
        return { data: result };
      }),

      updateBuilderProfile: builder.updateBuilderProfile
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const result = await runEffect(
            services.builder.updateBuilderProfile(
              input.nearAccount,
              input,
              context.userId,
              context.walletAddress,
              context.user.role,
            ),
          );
          if (!result) {
            throw errors.NOT_FOUND({
              message: "Builder not found",
              data: { resource: "builder", resourceId: input.nearAccount },
            });
          }
          return { data: result };
        }),

      deleteBuilder: builder.deleteBuilder.use(auth.requireAdmin).handler(async ({ input }) => {
        return await runEffect(services.builder.deleteBuilder(input.nearAccount));
      }),
    };
  },
});
