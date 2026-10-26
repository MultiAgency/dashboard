import { and, eq, or } from "drizzle-orm";
import { Effect, Either } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { organizationBuilders, projectContributors } from "../db/schema";
import { nearAccountsOf, type PluginContext } from "../lib/organizations";
import type { PluginsClient } from "../lib/plugins-types.gen";

export type BuilderProfile = {
  nearAccount: string;
  name: string | null;
  bio: string | null;
  skills: string[];
  location: string | null;
  links: Record<string, string> | null;
  githubLogin: string | null;
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
    githubLogin: string | null;
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
    githubLogin: data.githubLogin,
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
    githubLogin: null,
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

export type ManagerScope = { organizationId: string };

const notYourBuilder = () =>
  new ORPCError("FORBIDDEN", {
    message:
      "Only the builder, or an Agency that added them or has them on its Projects, can change this profile.",
  });

const asManager = (context: PluginContext): PluginContext => ({ ...context, trusted: true });

const asOrpcError = (err: unknown) =>
  err instanceof ORPCError ? err : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) });

export function createContributorsService(db: Database, plugins: PluginsClient) {
  async function managesBuilder(manager: ManagerScope | undefined, nearAccount: string) {
    if (!manager) return false;
    const [added] = await db
      .select({ nearAccount: organizationBuilders.nearAccount })
      .from(organizationBuilders)
      .where(
        and(
          eq(organizationBuilders.organizationId, manager.organizationId),
          eq(organizationBuilders.nearAccount, nearAccount),
        ),
      )
      .limit(1);
    if (added) return true;
    const [assigned] = await db
      .select({ projectId: projectContributors.projectId })
      .from(projectContributors)
      .where(
        and(
          eq(projectContributors.nearAccount, nearAccount),
          or(
            eq(projectContributors.organizationId, manager.organizationId),
            eq(projectContributors.assignedByOrganizationId, manager.organizationId),
          ),
        ),
      )
      .limit(1);
    return !!assigned;
  }

  async function recordAdded(manager: ManagerScope | undefined, nearAccount: string) {
    if (!manager) return;
    await db
      .insert(organizationBuilders)
      .values({ organizationId: manager.organizationId, nearAccount })
      .onConflictDoNothing();
  }

  return {
    list: (context: PluginContext, manager?: ManagerScope) =>
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

        const manageable = manager
          ? yield* Effect.promise(async () => {
              const [added, assigned] = await Promise.all([
                db
                  .select({ nearAccount: organizationBuilders.nearAccount })
                  .from(organizationBuilders)
                  .where(eq(organizationBuilders.organizationId, manager.organizationId)),
                db
                  .selectDistinct({ nearAccount: projectContributors.nearAccount })
                  .from(projectContributors)
                  .where(
                    or(
                      eq(projectContributors.organizationId, manager.organizationId),
                      eq(projectContributors.assignedByOrganizationId, manager.organizationId),
                    ),
                  ),
              ]);
              return [...new Set([...added, ...assigned].map((r) => r.nearAccount))];
            })
          : [];

        return { data: [...byNear.values()], manageable };
      }),

    get: (context: PluginContext, nearAccount: string, manager?: ManagerScope) =>
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
        const manages = yield* Effect.promise(() => managesBuilder(manager, nearAccount));
        if (Either.isRight(builder)) {
          const profile = builder.right.data;
          const managesUnclaimed = manages && !profile.userId && !profile.githubLogin;
          return {
            contributor: toProfile(profile),
            canEdit: managesUnclaimed || canEditProfile(context, profile),
            canDelete: !profile.githubLogin && (managesUnclaimed || isPlatformAdmin(context)),
          };
        }
        if (assignmentRows.length === 0) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Builder not found" }));
        }
        return {
          contributor: stubProfile(nearAccount),
          canEdit: manages || isPlatformAdmin(context),
          canDelete: false,
        };
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
      manager?: ManagerScope,
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
        yield* Effect.promise(() => recordAdded(manager, nearAccount));
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
      manager?: ManagerScope,
    ) =>
      Effect.gen(function* () {
        const self = isPlatformAdmin(context) || canEditProfile(context, input);
        const manages = self
          ? false
          : yield* Effect.promise(() => managesBuilder(manager, input.nearAccount));
        if (!self && !manages) return yield* Effect.fail(notYourBuilder());
        const caller = manages ? asManager(context) : context;
        const profile = {
          nearAccount: input.nearAccount,
          name: input.name,
          bio: input.bio,
          skills: input.skills,
          location: input.location,
          links: input.links,
        };
        const result = yield* Effect.tryPromise({
          try: () => plugins.builders(caller).updateBuilderProfile(profile),
          catch: (err) => err,
        }).pipe(
          Effect.catchIf(
            (err) => err instanceof ORPCError && err.code === "NOT_FOUND",
            () =>
              Effect.promise(async () => {
                const created = await plugins.builders(asManager(context)).createBuilder(profile);
                await recordAdded(manager, input.nearAccount);
                return created;
              }),
          ),
          Effect.mapError((err) =>
            err instanceof ORPCError
              ? err
              : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) }),
          ),
        );
        return { contributor: toProfile(result.data) };
      }),

    delete: (context: PluginContext, nearAccount: string, manager?: ManagerScope) =>
      Effect.gen(function* () {
        const allowed =
          isPlatformAdmin(context) ||
          (yield* Effect.promise(() => managesBuilder(manager, nearAccount)));
        if (!allowed) return yield* Effect.fail(notYourBuilder());
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
        const result = yield* Effect.tryPromise({
          try: () => plugins.builders(asManager(context)).deleteBuilder({ nearAccount }),
          catch: (err) =>
            err instanceof ORPCError
              ? err
              : new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err) }),
        });
        yield* Effect.promise(() =>
          db.delete(organizationBuilders).where(eq(organizationBuilders.nearAccount, nearAccount)),
        );
        return result;
      }),

    members: (context: PluginContext) =>
      Effect.tryPromise({
        try: () => plugins.builders(context).listMembersWithAgreements({}),
        catch: asOrpcError,
      }),

    recordAgreement: (
      context: PluginContext,
      input: { githubLogin: string; version: string; attestedAt: string; proof: string },
    ) =>
      Effect.tryPromise({
        try: () => plugins.builders(context).recordAgreement(input),
        catch: asOrpcError,
      }),
  };
}

export type ContributorsService = ReturnType<typeof createContributorsService>;
