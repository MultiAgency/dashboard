import { createHash, timingSafeEqual } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { buildScoped, createPlugin, type PluginInitializeInput } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import { type BuilderCaller, BuilderService, BuilderServiceLive } from "./services/builders";
import { MemberService, MemberServiceLive, type Network } from "./services/members";

function callerOf(context: unknown): BuilderCaller {
  const ctx = context as {
    userId: string;
    trusted?: boolean;
    near?: {
      primaryAccountId?: string | null;
      linkedAccounts?: Array<{ accountId: string }> | null;
    } | null;
    user?: { role?: string | null } | null;
  };
  const accounts = [
    ...(ctx.near?.primaryAccountId ? [ctx.near.primaryAccountId] : []),
    ...(ctx.near?.linkedAccounts ?? []).map((a) => a.accountId),
  ];
  return {
    userId: ctx.userId,
    accounts: [...new Set(accounts)],
    userRole: ctx.user?.role ?? undefined,
    trusted: ctx.trusted === true,
  };
}

const digest = (value: string) => createHash("sha256").update(value).digest();

function tokenMatches(expected: string | undefined, provided: string | null | undefined) {
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(expected), digest(provided));
}

const variables = z.object({});

const secrets = z.object({
  BUILDERS_DATABASE_URL: z.string().default("pglite:.bos/builders/:memory:"),
  REGISTRY_TOKEN_TESTNET: z.string().optional(),
  REGISTRY_TOKEN_MAINNET: z.string().optional(),
});

const initializeServices = (config: PluginInitializeInput<typeof variables, typeof secrets>) =>
  Effect.gen(function* () {
    const db = yield* buildScoped(DatabaseTag, DatabaseLive(config.secrets.BUILDERS_DATABASE_URL));
    const withDatabase = Layer.provide(Layer.succeed(DatabaseTag, db));
    const builder = yield* buildScoped(BuilderService, BuilderServiceLive.pipe(withDatabase));
    const member = yield* buildScoped(MemberService, MemberServiceLive.pipe(withDatabase));

    console.log("[Builders] Services Initialized");
    return {
      builder,
      member,
      registryTokens: {
        testnet: config.secrets.REGISTRY_TOKEN_TESTNET,
        mainnet: config.secrets.REGISTRY_TOKEN_MAINNET,
      } satisfies Record<Network, string | undefined>,
    };
  });

type BuildersServicesShape = Effect.Success<ReturnType<typeof initializeServices>>;

class BuildersServices extends Context.Service<BuildersServices, BuildersServicesShape>()(
  "BuildersServices",
) {}

export default createPlugin({
  variables,

  secrets,

  context: ContextSchema,

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const services = yield* initializeServices(config);
      yield* Effect.addFinalizer(() => Effect.log("[Builders] Shutdown"));
      return Layer.succeed(BuildersServices, services);
    }),

  createRouter: (builder) => {
    const auth = createAuthMiddleware(builder);

    return {
      listBuilders: builder.listBuilders.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], BuildersServices);
        return await runEffect(services.builder.listBuilders(input));
      }),

      getBuilder: builder.getBuilder.handler(async ({ input, errors, context }) => {
        const services = Context.get(context["effect/context"], BuildersServices);
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
          const services = Context.get(context["effect/context"], BuildersServices);
          const ctx = context as any;
          const result = await runEffect(
            services.builder.getBuilderByUserId(
              ctx.userId,
              ctx.near?.primaryAccountId ?? undefined,
            ),
          );
          return { data: result };
        }),

      createBuilder: builder.createBuilder
        .use(auth.requireAuth)
        .handler(async ({ input, context }) => {
          const services = Context.get(context["effect/context"], BuildersServices);
          const result = await runEffect(services.builder.createBuilder(input, callerOf(context)));
          return { data: result };
        }),

      updateBuilderProfile: builder.updateBuilderProfile
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
          const services = Context.get(context["effect/context"], BuildersServices);
          const result = await runEffect(
            services.builder.updateBuilderProfile(input.nearAccount, input, callerOf(context)),
          );
          if (!result) {
            throw errors.NOT_FOUND({
              message: "Builder not found",
              data: { resource: "builder", resourceId: input.nearAccount },
            });
          }
          return { data: result };
        }),

      deleteBuilder: builder.deleteBuilder
        .use(auth.requireAuth)
        .handler(async ({ input, context }) => {
          const services = Context.get(context["effect/context"], BuildersServices);
          return await runEffect(
            services.builder.deleteBuilder(input.nearAccount, callerOf(context)),
          );
        }),

      listMembers: builder.listMembers.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], BuildersServices);
        return { data: await runEffect(services.member.listMembers(input)) };
      }),

      getMember: builder.getMember.handler(async ({ input, errors, context }) => {
        const services = Context.get(context["effect/context"], BuildersServices);
        const result = await runEffect(services.member.getMember(input.githubLogin));
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Member not found",
            data: { resource: "member", resourceId: input.githubLogin },
          });
        }
        return { data: result };
      }),

      putMember: builder.putMember.handler(async ({ input, context }) => {
        const services = Context.get(context["effect/context"], BuildersServices);
        const provided = context.reqHeaders?.get("x-registry-token");
        if (!tokenMatches(services.registryTokens[input.network], provided)) {
          const other = input.network === "mainnet" ? "testnet" : "mainnet";
          if (tokenMatches(services.registryTokens[other], provided)) {
            throw new ORPCError("FORBIDDEN", {
              message: `This token writes ${other} members, not ${input.network}`,
            });
          }
          throw new ORPCError("UNAUTHORIZED", {
            message: `A ${input.network} registry token is required`,
          });
        }
        return await runEffect(services.member.putMember(input));
      }),

      listMembersWithAgreements: builder.listMembersWithAgreements
        .use(auth.requireAuth)
        .handler(async ({ context }) => {
          const services = Context.get(context["effect/context"], BuildersServices);
          return {
            data: await runEffect(services.member.listMembersWithAgreements(callerOf(context))),
          };
        }),

      recordAgreement: builder.recordAgreement
        .use(auth.requireAuth)
        .handler(async ({ input, context }) => {
          const services = Context.get(context["effect/context"], BuildersServices);
          const { githubLogin, ...agreement } = input;
          return {
            data: await runEffect(
              services.member.recordAgreement(githubLogin, agreement, callerOf(context)),
            ),
          };
        }),
    };
  },
});
