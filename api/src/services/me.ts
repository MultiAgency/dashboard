import { desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import type { Database } from "../db";
import { projectContributors } from "../db/schema";
import type { AgencyService } from "./agency";

export function createMeService(db: Database, agency: AgencyService) {
  return {
    assignedProjects: (
      context: Record<string, unknown>,
      orgAccountId: string,
      nearAccount: string,
    ) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(projectContributors)
            .where(eq(projectContributors.nearAccount, nearAccount))
            .orderBy(desc(projectContributors.createdAt)),
        );

        const allProjects = yield* Effect.promise(() =>
          agency.fetchOrgProjects(orgAccountId, context),
        );
        const projectById = new Map(allProjects.map((p) => [p.id, p]));

        const data = rows
          .map((r) => {
            const project = projectById.get(r.projectId);
            if (!project) return null;
            return {
              projectId: r.projectId,
              projectSlug: project.slug,
              projectTitle: project.title,
              role: r.role,
              onboardingStatus: r.onboardingStatus,
              createdAt: r.createdAt,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null);

        return { data };
      }),
  };
}

export type MeService = ReturnType<typeof createMeService>;
