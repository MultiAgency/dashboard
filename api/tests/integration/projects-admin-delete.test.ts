import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  billings,
  budgets,
  engagementProjects,
  engagements,
  listings,
  projectContributors,
} from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { agencyScope, inMemoryProjectsPlugin, project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

const AGENCY_ORG = "agency-org";
const scope = agencyScope("agency.sputnik-dao.testnet", { organizationId: AGENCY_ORG });

describe("deleting a Project", () => {
  const database = migratedDatabase({ perTest: true });
  let db: typeof database.db;
  let world: ReturnType<typeof inMemoryProjectsPlugin>;
  let deleted: string[];

  beforeEach(async () => {
    db = database.db;
    world = inMemoryProjectsPlugin([project("plain", AGENCY_ORG), project("used", AGENCY_ORG)]);
    deleted = [];
    const projects = world.plugins.projects;
    world.plugins.projects = ((context: { trusted?: boolean }) => ({
      ...projects(context as never),
      deleteProject: async ({ id }: { id: string }) => {
        if (!context.trusted) throw new Error("FORBIDDEN");
        deleted.push(id);
        return { success: true };
      },
    })) as never;
  });

  function agency() {
    const listings = createListingsService(db, world.directory);
    return createAgencyService(
      db,
      world.plugins,
      world.directory,
      listings,
      createProjectLedgers(db, listings),
    );
  }

  const remove = (id: string) => runEffect(agency().deleteProject(scope, { id }));

  test("a Project without money history or sharing is deleted through the trusted plugin call, with its assignments and listings", async () => {
    await db.insert(projectContributors).values({ projectId: "plain", nearAccount: "dev.near" });
    await db.insert(listings).values({ id: "listing", projectId: "plain", source: "internal" });

    await expect(remove("plain")).resolves.toEqual({ deleted: true });

    expect(deleted).toEqual(["plain"]);
    expect(
      await db.select().from(projectContributors).where(eq(projectContributors.projectId, "plain")),
    ).toEqual([]);
    expect(await db.select().from(listings)).toEqual([]);
  });

  test.each([
    [
      "shared through an Engagement",
      async () => {
        await db.insert(engagements).values({
          id: "ended",
          agencyOrganizationId: AGENCY_ORG,
          clientOrganizationId: "client-org",
          status: "ended",
          proposedBy: "admin",
        });
        await db.insert(engagementProjects).values({ engagementId: "ended", projectId: "used" });
      },
    ],
    [
      "holding Budget entries",
      async () => {
        await db.insert(budgets).values({
          id: "b1",
          projectId: "used",
          tokenId: "near",
          amount: "0",
          actorAccountId: "admin.near",
        });
      },
    ],
    [
      "holding Billings",
      async () => {
        await db.insert(billings).values({
          id: "bill",
          projectId: "used",
          tokenId: "near",
          amount: "1",
          proposalId: "7",
        });
      },
    ],
  ])("a Project %s can only be archived", async (_, seed) => {
    await seed();

    await expect(remove("used")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "ARCHIVE_ONLY" },
    });
    expect(deleted).toEqual([]);

    const archived = await runEffect(
      agency().updateProject(scope, { id: "used", status: "archived" }),
    );
    expect(archived.project.status).toBe("archived");
  });
});
