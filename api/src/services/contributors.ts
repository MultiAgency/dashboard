import { eq } from "drizzle-orm";
import { Effect, Either } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";
import { nearAccountsOf, type PluginContext } from "../lib/organizations";
import type { PluginsClient } from "../lib/plugins-types.gen";

export type BuilderProfile = {
  nearAccount: string;
  name: string | null;
  bio: string | null;
  skills: string[];
  location: string | null;
  links: Record<string, string> | null;
  registered: boolean;
  createdAt: string;
  updatedAt: string;
};

function toProfile(
  data: {
    nearAccount: string;
    name: string | null;
    bio: string | null;
    skills: string[];
    location: string | null;
    links: Record<string, string> | null;
    createdAt: string;
    updatedAt: string;
  },
  registered = true,
): BuilderProfile {
  return {
    nearAccount: data.nearAccount,
    name: data.name,
    bio: data.bio,
    skills: data.skills,
    location: data.location,
    links: data.links,
    registered,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function stubProfile(nearAccount: string): BuilderProfile {
  const now = new Date().toISOString();
  return {
    nearAccount,
    name: null,
    bio: null,
    skills: [],
    location: null,
    links: null,
    registered: false,
    createdAt: now,
    updatedAt: now,
  };
}

function canEditProfile(
  context: PluginContext,
  profile: { nearAccount: string; userId?: string | null },
): boolean {
  const user = (context as { user?: { role?: string | null } | null }).user;
  if (user?.role === "admin") return true;
  if (
    context.userId &&
    (profile.userId === context.userId || profile.nearAccount === context.userId)
  ) {
    return true;
  }
  return nearAccountsOf(context).includes(profile.nearAccount);
}

export function createContributorsService(db: Database, plugins: PluginsClient) {
  return {
    list: (context: PluginContext) =>
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          plugins.builders(context).listBuilders({ limit: 100 }),
        );
        const byNear = new Map(result.data.map((row) => [row.nearAccount, toProfile(row)]));

        const assignmentRows = yield* Effect.promise(() =>
          db
            .selectDistinct({ nearAccount: projectContributors.nearAccount })
            .from(projectContributors),
        );
        for (const row of assignmentRows) {
          if (!byNear.has(row.nearAccount)) {
            byNear.set(row.nearAccount, stubProfile(row.nearAccount));
          }
        }

        return { data: [...byNear.values()] };
      }),

    get: (context: PluginContext, nearAccount: string) =>
      Effect.gen(function* () {
        const assignmentRows = yield* Effect.promise(() =>
          db
            .select({ nearAccount: projectContributors.nearAccount })
            .from(projectContributors)
            .where(eq(projectContributors.nearAccount, nearAccount))
            .limit(1),
        );

        const builder = yield* Effect.either(
          Effect.tryPromise(() => plugins.builders(context).getBuilder({ nearAccount })),
        );
        if (Either.isRight(builder)) {
          const profile = builder.right.data;
          return {
            contributor: toProfile(profile),
            canEdit: canEditProfile(context, profile),
          };
        }
        if (assignmentRows.length === 0) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Builder not found" }));
        }
        return { contributor: stubProfile(nearAccount), canEdit: true };
      }),

    create: (
      context: PluginContext,
      input: {
        nearAccount: string;
        name?: string;
        bio?: string;
        skills?: string[];
        location?: string;
        links?: Record<string, string>;
      },
    ) =>
      Effect.gen(function* () {
        if (!input.nearAccount?.trim()) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "nearAccount is required" }),
          );
        }
        const nearAccount = input.nearAccount.trim();
        const existing = yield* Effect.either(
          Effect.tryPromise(() => plugins.builders(context).getBuilder({ nearAccount })),
        );
        if (Either.isRight(existing)) return { contributor: toProfile(existing.right.data) };
        const result = yield* Effect.promise(() =>
          plugins.builders(context).createBuilder({
            nearAccount,
            name: input.name,
            bio: input.bio,
            skills: input.skills,
            location: input.location,
            links: input.links,
          }),
        );
        return { contributor: toProfile(result.data) };
      }),

    update: (
      context: PluginContext,
      input: {
        nearAccount: string;
        name?: string;
        bio?: string;
        skills?: string[];
        location?: string;
        links?: Record<string, string>;
      },
    ) =>
      Effect.gen(function* () {
        const profile = {
          nearAccount: input.nearAccount,
          name: input.name,
          bio: input.bio,
          skills: input.skills,
          location: input.location,
          links: input.links,
        };
        const result = yield* Effect.tryPromise({
          try: () => plugins.builders(context).updateBuilderProfile(profile),
          catch: (err) => err,
        }).pipe(
          Effect.catchIf(
            (err) => err instanceof ORPCError && err.code === "NOT_FOUND",
            () => Effect.promise(() => plugins.builders(context).createBuilder(profile)),
          ),
          Effect.mapError((err) =>
            err instanceof ORPCError
              ? err
              : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) }),
          ),
        );
        return { contributor: toProfile(result.data) };
      }),
  };
}

export type ContributorsService = ReturnType<typeof createContributorsService>;
