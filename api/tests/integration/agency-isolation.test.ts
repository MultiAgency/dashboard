import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets, projectContributors } from "../../src/db/schema";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBudgetsService } from "../../src/services/budgets";
import { createEngagementsService } from "../../src/services/engagements";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryOrganizationAccess } from "../fakes/organization-access";
import { inMemoryOrganizations } from "../fakes/organizations";
import { agencyScope, inMemoryProjects, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA = "alpha.sputnik-dao.near";
const BETA = "beta.sputnik-dao.near";

describe("agency isolation", () => {
  let pg: PGlite;
  let db: Database;
  const alpha = agencyScope(ALPHA);
  const beta = agencyScope(BETA);
  const directory = createProjectDirectory(
    () =>
      inMemoryProjects([
        project("alpha-project", ALPHA),
        project("alpha-other", ALPHA),
        project("beta-project", BETA),
      ]).client,
  );
  const access = inMemoryOrganizationAccess(inMemoryOrganizations([]).organizations, directory);

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE project_contributors, budgets, billings CASCADE");
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A>(effect: import("every-plugin/effect").Effect.Effect<A, unknown>) =>
    import("every-plugin/effect").then(({ Effect }) => Effect.runPromise(effect as never) as A);

  describe("project access", () => {
    test("an agency reaches only its own projects", async () => {
      expect(await access.projectAccess(alpha, "alpha-project")).toBe("owned");
      expect(await access.projectAccess(alpha, "beta-project")).toBeNull();
      expect(await access.projectAccess(beta, "beta-project")).toBe("owned");
    });
  });

  describe("assignments", () => {
    test("an agency cannot remove contributors from another agency's project", async () => {
      await db
        .insert(projectContributors)
        .values({ projectId: "beta-project", nearAccount: "dev.near", role: "lead" });

      await expect(
        run(
          createAssignmentsService(
            db,
            directory,
            createEngagementsService(
              db,
              directory,
              {
                daoOf: async () => null,
                nameOf: async () => null,
                create: async () => ({ id: "unused" }),
                invite: async () => {},
              },
              access,
            ),
          ).delete(alpha, {
            projectId: "beta-project",
            nearAccount: "dev.near",
          }),
        ),
      ).rejects.toThrow("Project not found");
      expect(await db.select().from(projectContributors)).toHaveLength(1);
    });
  });

  describe("budgets", () => {
    async function allocate(projectId: string, amount: string) {
      await db.insert(budgets).values({
        id: crypto.randomUUID(),
        projectId,
        tokenId: "near",
        amount,
        actorAccountId: "admin.near",
      });
    }

    test("an agency's budget history excludes other agencies' projects", async () => {
      await allocate("alpha-project", "10");
      await allocate("beta-project", "99");
      const service = createBudgetsService(db, directory, access);

      const listed = await run(service.list(alpha, { limit: 50 }));

      expect(listed.data.map((b) => b.projectId)).toEqual(["alpha-project"]);
    });

    test("allocations are recorded against the acting member", async () => {
      const service = createBudgetsService(db, directory, access);

      const { budget } = await run(
        service.create(agencyScope(ALPHA, { actorId: "treasurer.near" }), {
          projectId: "alpha-project",
          tokenId: "near",
          amount: "5",
        }),
      );

      expect(budget).toMatchObject({
        actorAccountId: "treasurer.near",
        note: null,
      });
      await expect(
        run(service.create(alpha, { projectId: "beta-project", tokenId: "near", amount: "5" })),
      ).rejects.toThrow("Project not found");
    });
  });
});
