import { desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { contributors } from "../db/schema";

export function createContributorsService(db: Database) {
  return {
    list: () =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db.select().from(contributors).orderBy(desc(contributors.updatedAt)),
        );
        return { data: rows };
      }),

    create: (input: {
      name: string;
      email?: string;
      nearAccountId?: string;
      onboardingStatus?: "pending" | "complete" | "expired";
    }) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID();
        const now = new Date();
        const result = yield* Effect.promise(() =>
          db
            .insert(contributors)
            .values({
              id,
              name: input.name,
              email: input.email ?? null,
              nearAccountId: input.nearAccountId ?? null,
              onboardingStatus: input.onboardingStatus ?? "pending",
              createdAt: now,
              updatedAt: now,
            })
            .returning(),
        );
        const row = result[0];
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" }),
          );
        }
        return { contributor: row };
      }),

    update: (input: {
      id: string;
      name?: string;
      email?: string | null;
      nearAccountId?: string | null;
      onboardingStatus?: "pending" | "complete" | "expired";
    }) =>
      Effect.gen(function* () {
        const { id, ...patch } = input;
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) updates[k] = v;
        }
        const result = yield* Effect.promise(() =>
          db
            .update(contributors)
            .set(updates)
            .where(eq(contributors.id, id))
            .returning(),
        );
        const row = result[0];
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Contributor not found" }),
          );
        }
        return { contributor: row };
      }),
  };
}

export type ContributorsService = ReturnType<typeof createContributorsService>;
