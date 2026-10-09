import { createHash, timingSafeEqual } from "node:crypto";
import { createPlugin } from "every-plugin";
import { Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
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

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    BUILDERS_DATABASE_URL: z.string().default("pglite:.bos/builders/:memory:"),
    REGISTRY_TOKEN_TESTNET: z.string().optional(),
    REGISTRY_TOKEN_MAINNET: z.string().optional(),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const db = yield* tools.buildService(
        DatabaseTag,
        DatabaseLive(config.secrets.BUILDERS_DATABASE_URL),
      );
      const withDatabase = Layer.provide(Layer.succeed(DatabaseTag, db));
      const builder = yield* tools.buildService(
        BuilderService,
        BuilderServiceLive.pipe(withDatabase),
      );
      const member = yield* tools.buildService(MemberService, MemberServiceLive.pipe(withDatabase));

      console.log("[Builders] Services Initialized");
      return {
        builder,
        member,
        registryTokens: {
          testnet: config.secrets.REGISTRY_TOKEN_TESTNET,
          mainnet: config.secrets.REGISTRY_TOKEN_MAINNET,
        } satisfies Record<Network, string | undefined>,
      };
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
          const result = await runEffect(services.builder.createBuilder(input, callerOf(context)));
          return { data: result };
        }),

      updateBuilderProfile: builder.updateBuilderProfile
        .use(auth.requireAuth)
        .handler(async ({ input, context, errors }) => {
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
          return await runEffect(
            services.builder.deleteBuilder(input.nearAccount, callerOf(context)),
          );
        }),

      listMembers: builder.listMembers.handler(async ({ input }) => {
        return { data: await runEffect(services.member.listMembers(input)) };
      }),

      getMember: builder.getMember.handler(async ({ input, errors }) => {
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
          return {
            data: await runEffect(services.member.listMembersWithAgreements(callerOf(context))),
          };
        }),

      recordAgreement: builder.recordAgreement
        .use(auth.requireAuth)
        .handler(async ({ input, context }) => {
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
