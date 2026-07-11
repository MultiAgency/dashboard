import { and, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { contributors, projectContributors } from "../db/schema";

export function createAssignmentsService(db: Database) {
  return {
    list: (projectId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select({
              projectId: projectContributors.projectId,
              contributorId: projectContributors.contributorId,
              role: projectContributors.role,
              createdAt: projectContributors.createdAt,
              contributor: contributors,
            })
            .from(projectContributors)
            .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
            .where(eq(projectContributors.projectId, projectId)),
        );
        return { data: rows };
      }),

    create: (input: { projectId: string; contributorId: string; role?: string }) =>
      Effect.gen(function* () {
        const contributorExists = yield* Effect.promise(() =>
          db
            .select({ id: contributors.id })
            .from(contributors)
            .where(eq(contributors.id, input.contributorId))
            .limit(1),
        );
        if (contributorExists.length === 0) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Contributor not found" }),
          );
        }

        yield* Effect.promise(() =>
          db
            .insert(projectContributors)
            .values({
              projectId: input.projectId,
              contributorId: input.contributorId,
              role: input.role ?? null,
            })
            .onConflictDoUpdate({
              target: [projectContributors.projectId, projectContributors.contributorId],
              set: { role: input.role ?? null },
            }),
        );

        return {
          projectId: input.projectId,
          contributorId: input.contributorId,
          role: input.role ?? null,
        };
      }),

    delete: (input: { projectId: string; contributorId: string }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          db
            .delete(projectContributors)
            .where(
              and(
                eq(projectContributors.projectId, input.projectId),
                eq(projectContributors.contributorId, input.contributorId),
              ),
            ),
        );
        return { ok: true as const };
      }),
  };
}

export type AssignmentsService = ReturnType<typeof createAssignmentsService>;
