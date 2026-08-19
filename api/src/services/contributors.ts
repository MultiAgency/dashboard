import { eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";
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

export function createContributorsService(db: Database, plugins: PluginsClient) {
  return {
    list: (context: Record<string, unknown>) =>
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

    get: (context: Record<string, unknown>, nearAccount: string) =>
      Effect.gen(function* () {
        const assignmentRows = yield* Effect.promise(() =>
          db
            .select({ nearAccount: projectContributors.nearAccount })
            .from(projectContributors)
            .where(eq(projectContributors.nearAccount, nearAccount))
            .limit(1),
        );

        try {
          const result = yield* Effect.promise(() =>
            plugins.builders(context).getBuilder({ nearAccount }),
          );
          return { contributor: toProfile(result.data) };
        } catch {
          if (assignmentRows.length === 0) {
            return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Builder not found" }));
          }
          return { contributor: stubProfile(nearAccount) };
        }
      }),

    create: (
      context: Record<string, unknown>,
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
        const result = yield* Effect.promise(() =>
          plugins.builders(context).createBuilder({
            nearAccount: input.nearAccount.trim(),
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
      context: Record<string, unknown>,
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
        try {
          const result = yield* Effect.promise(() =>
            plugins.builders(context).updateBuilderProfile({
              nearAccount: input.nearAccount,
              name: input.name,
              bio: input.bio,
              skills: input.skills,
              location: input.location,
              links: input.links,
            }),
          );
          return { contributor: toProfile(result.data) };
        } catch {
          const created = yield* Effect.promise(() =>
            plugins.builders(context).createBuilder({
              nearAccount: input.nearAccount,
              name: input.name,
              bio: input.bio,
              skills: input.skills,
              location: input.location,
              links: input.links,
            }),
          );
          return { contributor: toProfile(created.data) };
        }
      }),
  };
}

export type ContributorsService = ReturnType<typeof createContributorsService>;
