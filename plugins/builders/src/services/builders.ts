import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { DatabaseTag } from "../db/layer";
import { builders } from "../db/schema";

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return typeof value === "string" ? value : value.toISOString();
}

function parseSkills(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseLinks(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeSkills(skills?: string[]): string {
  return JSON.stringify(skills ?? []);
}

function serializeLinks(links?: Record<string, string>): string | null {
  if (!links || Object.keys(links).length === 0) return null;
  return JSON.stringify(links);
}

export interface Builder {
  id: string;
  nearAccount: string;
  userId: string | null;
  name: string | null;
  bio: string | null;
  skills: string[];
  location: string | null;
  links: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

function rowToBuilder(row: any): Builder {
  return {
    id: row.id,
    nearAccount: row.nearAccount,
    userId: row.userId ?? null,
    name: row.name ?? null,
    bio: row.bio ?? null,
    skills: parseSkills(row.skills),
    location: row.location ?? null,
    links: parseLinks(row.links),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

/**
 * `accounts` are the NEAR accounts the caller signed in with or linked.
 * `trusted` is set only by the API, calling in-process for an Agency manager;
 * the host never sets it on a request.
 */
export type BuilderCaller = {
  userId: string;
  accounts: string[];
  userRole?: string;
  trusted: boolean;
};

function isPlatformAdmin(caller: BuilderCaller): boolean {
  return caller.userRole === "admin";
}

function isBuilder(row: { nearAccount: string; userId: string | null }, caller: BuilderCaller) {
  return (
    caller.accounts.includes(row.nearAccount) ||
    row.nearAccount === caller.userId ||
    row.userId === caller.userId
  );
}

// Anyone else creating it would speak for an account they cannot prove is theirs.
function canCreate(nearAccount: string, caller: BuilderCaller) {
  return isPlatformAdmin(caller) || caller.trusted || caller.accounts.includes(nearAccount);
}

// A profile is claimed once its account's owner creates or saves it: their
// user is recorded on it. One an Agency wrote for them stays unclaimed.
function claimant(nearAccount: string, caller: BuilderCaller) {
  return caller.accounts.includes(nearAccount) ? caller.userId : null;
}

function canManage(row: { userId: string | null }, caller: BuilderCaller) {
  return caller.trusted && row.userId === null;
}

const cannotEdit = () =>
  new ORPCError("FORBIDDEN", {
    message: "Only the builder or a platform admin can edit this profile",
  });

function generateId(): string {
  return `bld_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class BuilderService extends Context.Tag("builders/BuilderService")<
  BuilderService,
  {
    listBuilders: (input: {
      search?: string;
      skill?: string;
      limit?: number;
      cursor?: string;
    }) => Effect.Effect<
      {
        data: Builder[];
        meta: { total: number; hasMore: boolean; nextCursor: string | null };
      },
      ORPCError<string, unknown>
    >;

    getBuilder: (nearAccount: string) => Effect.Effect<Builder | null, ORPCError<string, unknown>>;

    getBuilderByUserId: (
      userId: string,
      walletAddress?: string,
    ) => Effect.Effect<Builder | null, ORPCError<string, unknown>>;

    createBuilder: (
      input: {
        nearAccount: string;
        userId?: string;
        name?: string;
        bio?: string;
        skills?: string[];
        location?: string;
        links?: Record<string, string>;
      },
      caller: BuilderCaller,
    ) => Effect.Effect<Builder, ORPCError<string, unknown>>;

    updateBuilderProfile: (
      nearAccount: string,
      input: {
        name?: string;
        bio?: string;
        skills?: string[];
        location?: string;
        links?: Record<string, string>;
      },
      caller: BuilderCaller,
    ) => Effect.Effect<Builder, ORPCError<string, unknown>>;

    deleteBuilder: (
      nearAccount: string,
      caller: BuilderCaller,
    ) => Effect.Effect<{ deleted: boolean }, ORPCError<string, unknown>>;
  }
>() {}

export const BuilderServiceLive = Layer.effect(
  BuilderService,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    return {
      listBuilders: (input) =>
        Effect.gen(function* () {
          const limit = Math.min(input.limit ?? 24, 100);
          const offset = input.cursor ? parseInt(input.cursor, 10) : 0;
          const conditions: any[] = [];

          if (input.search) {
            const pattern = `%${input.search}%`;
            conditions.push(
              or(
                ilike(builders.nearAccount, pattern),
                ilike(builders.name, pattern),
                ilike(builders.bio, pattern),
                ilike(builders.location, pattern),
                ilike(builders.skills, pattern),
              ),
            );
          }

          if (input.skill) {
            conditions.push(ilike(builders.skills, `%${input.skill}%`));
          }

          const whereClause = and(...conditions);

          const [totalResult] = yield* Effect.promise(() =>
            db.select({ count: count() }).from(builders).where(whereClause),
          );

          const total = totalResult?.count ?? 0;

          const records = yield* Effect.promise(() =>
            db
              .select()
              .from(builders)
              .where(whereClause)
              .orderBy(desc(builders.createdAt))
              .limit(limit)
              .offset(offset),
          );

          const nextOffset = offset + limit;
          const hasMore = nextOffset < total;

          return {
            data: records.map(rowToBuilder),
            meta: {
              total,
              hasMore,
              nextCursor: hasMore ? String(nextOffset) : null,
            },
          };
        }),

      getBuilder: (nearAccount) =>
        Effect.gen(function* () {
          const [row] = yield* Effect.promise(() =>
            db.select().from(builders).where(eq(builders.nearAccount, nearAccount)).limit(1),
          );
          return row ? rowToBuilder(row) : null;
        }),

      getBuilderByUserId: (userId, walletAddress) =>
        Effect.gen(function* () {
          const conditions: any[] = [];
          if (walletAddress) conditions.push(eq(builders.nearAccount, walletAddress));
          conditions.push(eq(builders.userId, userId));

          const [row] = yield* Effect.promise(() =>
            db
              .select()
              .from(builders)
              .where(and(or(...conditions)))
              .limit(1),
          );
          return row ? rowToBuilder(row) : null;
        }),

      createBuilder: (input, caller) =>
        Effect.gen(function* () {
          if (input.userId && input.userId !== caller.userId && !isPlatformAdmin(caller)) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message: "A profile can only be linked to your own user",
              }),
            );
          }
          const [existing] = yield* Effect.promise(() =>
            db.select().from(builders).where(eq(builders.nearAccount, input.nearAccount)).limit(1),
          );

          if (existing) {
            if (!isPlatformAdmin(caller) && !isBuilder(existing, caller)) {
              return yield* Effect.fail(cannotEdit());
            }
            const now = new Date();
            yield* Effect.promise(() =>
              db
                .update(builders)
                .set({
                  userId: input.userId ?? existing.userId ?? claimant(input.nearAccount, caller),
                  name: input.name?.trim() ?? existing.name,
                  bio: input.bio?.trim() ?? existing.bio,
                  skills:
                    input.skills !== undefined ? serializeSkills(input.skills) : existing.skills,
                  location: input.location?.trim() ?? existing.location,
                  links: input.links !== undefined ? serializeLinks(input.links) : existing.links,
                  updatedAt: now,
                })
                .where(eq(builders.nearAccount, input.nearAccount)),
            );

            const [updated] = yield* Effect.promise(() =>
              db
                .select()
                .from(builders)
                .where(eq(builders.nearAccount, input.nearAccount))
                .limit(1),
            );

            return rowToBuilder(updated);
          }

          if (!canCreate(input.nearAccount, caller)) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message:
                  "You can create a profile only for a NEAR account you signed in with or linked",
              }),
            );
          }

          const now = new Date();
          const id = generateId();
          const userId = input.userId ?? claimant(input.nearAccount, caller);

          yield* Effect.promise(() =>
            db.insert(builders).values({
              id,
              nearAccount: input.nearAccount,
              userId,
              name: input.name?.trim() ?? null,
              bio: input.bio?.trim() ?? null,
              skills: serializeSkills(input.skills),
              location: input.location?.trim() ?? null,
              links: serializeLinks(input.links),
              createdAt: now,
              updatedAt: now,
            }),
          );

          return {
            id,
            nearAccount: input.nearAccount,
            userId,
            name: input.name?.trim() ?? null,
            bio: input.bio?.trim() ?? null,
            skills: input.skills ?? [],
            location: input.location?.trim() ?? null,
            links: input.links && Object.keys(input.links).length > 0 ? input.links : null,
            createdAt: toIsoString(now),
            updatedAt: toIsoString(now),
          };
        }),

      updateBuilderProfile: (nearAccount, input, caller) =>
        Effect.gen(function* () {
          const [existing] = yield* Effect.promise(() =>
            db.select().from(builders).where(eq(builders.nearAccount, nearAccount)).limit(1),
          );

          if (!existing) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", { message: "Builder profile not found" }),
            );
          }

          if (
            !isPlatformAdmin(caller) &&
            !isBuilder(existing, caller) &&
            !canManage(existing, caller)
          ) {
            return yield* Effect.fail(cannotEdit());
          }

          const now = new Date();
          const updates: any = { updatedAt: now };
          if (!existing.userId) updates.userId = claimant(nearAccount, caller);

          if (input.name !== undefined) updates.name = input.name.trim() || null;
          if (input.bio !== undefined) updates.bio = input.bio.trim() || null;
          if (input.skills !== undefined) updates.skills = serializeSkills(input.skills);
          if (input.location !== undefined) updates.location = input.location.trim() || null;
          if (input.links !== undefined) updates.links = serializeLinks(input.links);

          yield* Effect.promise(() =>
            db.update(builders).set(updates).where(eq(builders.nearAccount, nearAccount)),
          );

          const [updated] = yield* Effect.promise(() =>
            db.select().from(builders).where(eq(builders.nearAccount, nearAccount)).limit(1),
          );

          return rowToBuilder(updated);
        }),

      deleteBuilder: (nearAccount, caller) =>
        Effect.gen(function* () {
          const [existing] = yield* Effect.promise(() =>
            db.select().from(builders).where(eq(builders.nearAccount, nearAccount)).limit(1),
          );

          if (!existing) {
            return yield* Effect.fail(
              new ORPCError("NOT_FOUND", { message: "Builder profile not found" }),
            );
          }

          if (!isPlatformAdmin(caller) && !canManage(existing, caller)) {
            return yield* Effect.fail(
              new ORPCError("FORBIDDEN", {
                message: "Only a platform admin can remove a profile its builder has claimed",
              }),
            );
          }

          yield* Effect.promise(() =>
            db.delete(builders).where(eq(builders.nearAccount, nearAccount)),
          );

          return { deleted: true };
        }),
    };
  }),
);
