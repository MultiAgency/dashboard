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
  /** Saved by the account's owner; otherwise an Agency wrote it for them. */
  claimed: boolean;
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
    userId: string | null;
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
    claimed: data.userId !== null,
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
    claimed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function isPlatformAdmin(context: PluginContext): boolean {
  return (context as { user?: { role?: string | null } | null }).user?.role === "admin";
}

function canEditProfile(
  context: PluginContext,
  profile: { nearAccount: string; userId?: string | null },
): boolean {
  if (isPlatformAdmin(context)) return true;
  if (
    context.userId &&
    (profile.userId === context.userId || profile.nearAccount === context.userId)
  ) {
    return true;
  }
  return nearAccountsOf(context).includes(profile.nearAccount);
}

// Create and update are open only to an Agency's managers (the `manager`
// middleware), who may create a profile for a contributor's account; the
// builders plugin lets a trusted, in-process call do that.
const asManager = (context: PluginContext): PluginContext => ({ ...context, trusted: true });

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

    get: (context: PluginContext, nearAccount: string, options: { canManage?: boolean } = {}) =>
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
          const managesUnclaimed = !!options.canManage && !profile.userId;
          return {
            contributor: toProfile(profile),
            canEdit: managesUnclaimed || canEditProfile(context, profile),
            canDelete: managesUnclaimed || isPlatformAdmin(context),
          };
        }
        if (assignmentRows.length === 0) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Builder not found" }));
        }
        return { contributor: stubProfile(nearAccount), canEdit: true, canDelete: false };
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
          plugins.builders(asManager(context)).createBuilder({
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
          try: () => plugins.builders(asManager(context)).updateBuilderProfile(profile),
          catch: (err) => err,
        }).pipe(
          Effect.catchIf(
            (err) => err instanceof ORPCError && err.code === "NOT_FOUND",
            () => Effect.promise(() => plugins.builders(asManager(context)).createBuilder(profile)),
          ),
          Effect.mapError((err) =>
            err instanceof ORPCError
              ? err
              : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) }),
          ),
        );
        return { contributor: toProfile(result.data) };
      }),

    delete: (context: PluginContext, nearAccount: string) =>
      Effect.gen(function* () {
        const [assigned] = yield* Effect.promise(() =>
          db
            .select({ projectId: projectContributors.projectId })
            .from(projectContributors)
            .where(eq(projectContributors.nearAccount, nearAccount))
            .limit(1),
        );
        if (assigned) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "This builder is still assigned to a Project. Remove them from it first.",
            }),
          );
        }
        return yield* Effect.tryPromise({
          try: () => plugins.builders(asManager(context)).deleteBuilder({ nearAccount }),
          catch: (err) =>
            err instanceof ORPCError
              ? err
              : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) }),
        });
      }),
  };
}

export type ContributorsService = ReturnType<typeof createContributorsService>;
