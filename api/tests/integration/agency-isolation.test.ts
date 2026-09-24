import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { budgets, engagements, projectContributors } from "../../src/db/schema";
import { createAssignmentsService } from "../../src/services/assignments";
import { createBudgetsService } from "../../src/services/budgets";
import {
  ROLE_MATRIX,
  requireTreasury,
  type TreasuryScope,
} from "../../src/services/organization-access";
import { createProjectDirectory } from "../../src/services/project-directory";
import { inMemoryAccess, seedAgencyDaos, signedIn } from "../fakes/organizations";
import { inMemoryProjects, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA = "alpha.sputnik-dao.near";
const BETA = "beta.sputnik-dao.near";

const agencies = [
  { id: "alpha-org", daoAccountId: ALPHA },
  { id: "beta-org", daoAccountId: BETA },
];

describe("agency isolation", () => {
  let pg: PGlite;
  let db: Database;
  let alpha: TreasuryScope;
  let alphaTreasurer: TreasuryScope;
  const directory = createProjectDirectory(
    () =>
      inMemoryProjects([
        project("alpha-project", ALPHA),
        project("alpha-other", ALPHA),
        project("beta-project", BETA),
      ]).client,
  );

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    await seedAgencyDaos(db, agencies);
    const access = inMemoryAccess(db, {
      organizations: agencies,
      members: [
        { userId: "alpha-admin", organizationId: "alpha-org", role: "admin" },
        { userId: "alpha-treasurer", organizationId: "alpha-org", role: "owner" },
      ],
    });
    const manager = async (userId: string, organizationId: string, near: string) =>
      requireTreasury(
        await access.agencyScope(signedIn(userId, organizationId, near), ROLE_MATRIX.manage),
      );
    alpha = await manager("alpha-admin", "alpha-org", "admin.near");
    alphaTreasurer = await manager("alpha-treasurer", "alpha-org", "treasurer.near");
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE engagements, engagement_projects, project_contributors, budgets, billings CASCADE",
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A>(effect: import("every-plugin/effect").Effect.Effect<A, unknown>) =>
    import("every-plugin/effect").then(({ Effect }) => Effect.runPromise(effect as never) as A);

  async function betaEngagement() {
    await db.insert(engagements).values({
      id: "beta-engagement",
      agencyOrganizationId: "beta-org",
      clientOrganizationId: "beta-client-org",
      status: "active",
      proposedBy: "beta-admin",
    });
    return "beta-engagement";
  }

  describe("assignments", () => {
    test("an agency cannot remove contributors from another agency's project", async () => {
      await db
        .insert(projectContributors)
        .values({ projectId: "beta-project", nearAccount: "dev.near", role: "lead" });

      await expect(
        run(
          createAssignmentsService(db, directory).delete(alpha, {
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
      const service = createBudgetsService(db, directory);

      const listed = await run(service.list(alpha, { limit: 50 }));

      expect(listed.data.map((b) => b.projectId)).toEqual(["alpha-project"]);
    });

    test("another agency's engagement cannot be used to filter budgets", async () => {
      const engagementId = await betaEngagement();
      const service = createBudgetsService(db, directory);

      await expect(run(service.list(alpha, { engagementId, limit: 50 }))).rejects.toThrow(
        "Engagement not found",
      );
    });

    test("allocations are recorded against the acting member", async () => {
      const service = createBudgetsService(db, directory);

      const { budget } = await run(
        service.create(alphaTreasurer, {
          projectId: "alpha-project",
          tokenId: "near",
          amount: "5",
        }),
      );

      expect(budget).toMatchObject({
        actorAccountId: "treasurer.near",
        note: null,
        engagementId: null,
      });
      const betaEngagementId = await betaEngagement();
      await expect(
        run(
          service.create(alpha, {
            projectId: "alpha-project",
            tokenId: "near",
            amount: "5",
            engagementId: betaEngagementId,
          }),
        ),
      ).rejects.toThrow("Engagement not found");
      await expect(
        run(service.create(alpha, { projectId: "beta-project", tokenId: "near", amount: "5" })),
      ).rejects.toThrow("Project not found");
    });
  });
});
