import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, projectContributors, proposals } from "../../src/db/schema";
import { createMeService } from "../../src/services/me";
import { engagementWorld } from "../fakes/engagements";
import { project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const STUDIO_DAO = "studio.sputnik-dao.near";

describe("my work as a Contributor", () => {
  let pg: PGlite;
  let db: Database;
  let me: ReturnType<typeof createMeService>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    const world = await engagementWorld(db, {
      organizations: [
        { id: "studio", name: "Studio", daoAccountId: STUDIO_DAO },
        { id: "labs", name: "Labs" },
      ],
      members: [],
      users: [],
      projects: [
        { ...project("studio-work", "studio"), title: "Studio work" },
        { ...project("labs-work", "labs"), title: "Labs work" },
        { ...project("unassigned", "studio"), title: "Unassigned" },
      ],
    });
    me = createMeService({
      db,
      directory: world.directory,
      organizations: world.organizations.directory,
      readScopeOf: world.access.readScopeOfAgency,
    });
    await db.insert(projectContributors).values([
      { projectId: "studio-work", nearAccount: "dev.near", organizationId: "studio" },
      { projectId: "labs-work", nearAccount: "alt.near", organizationId: "labs" },
      { projectId: "unassigned", nearAccount: "someone-else.near", organizationId: "studio" },
    ]);
  });

  afterEach(async () => {
    await pg.close();
  });

  const contributor = {
    userId: "dev",
    near: { primaryAccountId: "dev.near", linkedAccounts: [{ accountId: "alt.near" }] },
  };

  test("a Contributor with no membership sees private Projects assigned to any linked account across Agencies", async () => {
    const { data } = await me.assignedProjects(contributor);

    expect(data.map((p) => [p.projectTitle, p.agencyName]).sort()).toEqual([
      ["Labs work", "Labs"],
      ["Studio work", "Studio"],
    ]);
  });

  test("a user without a linked NEAR account has no assigned Projects", async () => {
    expect((await me.assignedProjects({ userId: "email-only" })).data).toEqual([]);
  });

  test("a Contributor sees only their own Billings, with the paying Agency's status", async () => {
    await db.insert(proposals).values({
      daoAccountId: STUDIO_DAO,
      proposalId: 7,
      proposer: "dev.near",
      description: "payout",
      status: "Approved",
      kindType: "Transfer",
      submissionTime: "0",
    });
    await db.insert(billings).values([
      {
        id: "mine",
        projectId: "studio-work",
        nearAccount: "dev.near",
        tokenId: "near",
        amount: "5",
        proposalId: "7",
      },
      {
        id: "theirs",
        projectId: "studio-work",
        nearAccount: "someone-else.near",
        tokenId: "near",
        amount: "9",
        proposalId: "8",
      },
    ]);

    const { data } = await me.billings(contributor, { limit: 50 });

    expect(data).toEqual([
      expect.objectContaining({
        id: "mine",
        status: "Approved",
        projectTitle: "Studio work",
        agencyName: "Studio",
      }),
    ]);
  });
});
