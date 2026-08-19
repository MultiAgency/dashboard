import { and, desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";

export function createAssignmentsService(db: Database) {
  return {
    list: (projectId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(eq(projectContributors.projectId, projectId))
            .orderBy(desc(projectContributors.createdAt)),
        );
        return {
          data: rows.map((r) => ({
            projectId: r.projectId,
            nearAccount: r.nearAccount,
            role: r.role,
            onboardingStatus: r.onboardingStatus,
            createdAt: r.createdAt,
          })),
        };
      }),

    listAll: () =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db.select().from(projectContributors).orderBy(desc(projectContributors.createdAt)),
        );
        return {
          data: rows.map((r) => ({
            projectId: r.projectId,
            nearAccount: r.nearAccount,
            role: r.role,
            onboardingStatus: r.onboardingStatus,
            createdAt: r.createdAt,
          })),
        };
      }),

    listForContributor: (nearAccount: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(eq(projectContributors.nearAccount, nearAccount))
            .orderBy(desc(projectContributors.createdAt)),
        );
        return { data: rows };
      }),

    create: (input: {
      projectId: string;
      nearAccount: string;
      role?: string;
      onboardingStatus?: string;
    }) =>
      Effect.gen(function* () {
        if (!input.nearAccount?.trim()) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "nearAccount is required" }),
          );
        }

        yield* Effect.promise(() =>
          db
            .insert(projectContributors)
            .values({
              projectId: input.projectId,
              nearAccount: input.nearAccount.trim(),
              role: input.role ?? null,
              onboardingStatus: input.onboardingStatus ?? "pending",
            })
            .onConflictDoUpdate({
              target: [projectContributors.projectId, projectContributors.nearAccount],
              set: {
                role: input.role ?? null,
                ...(input.onboardingStatus !== undefined
                  ? { onboardingStatus: input.onboardingStatus }
                  : {}),
              },
            }),
        );

        return {
          projectId: input.projectId,
          nearAccount: input.nearAccount.trim(),
          role: input.role ?? null,
          onboardingStatus: input.onboardingStatus ?? "pending",
        };
      }),

    delete: (input: { projectId: string; nearAccount: string }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          db
            .delete(projectContributors)
            .where(
              and(
                eq(projectContributors.projectId, input.projectId),
                eq(projectContributors.nearAccount, input.nearAccount),
              ),
            ),
        );
        return { ok: true as const };
      }),
  };
}

export type AssignmentsService = ReturnType<typeof createAssignmentsService>;
