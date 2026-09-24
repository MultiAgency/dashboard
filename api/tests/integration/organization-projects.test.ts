import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import {
  NO_AGENCY_DAO,
  ROLE_MATRIX,
  requireTreasury,
} from "../../src/services/organization-access";
import { inMemoryAccess, seedAgencyDaos, signedIn } from "../fakes/organizations";
import { inMemoryProjectsPlugin, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.testnet";

describe("Projects owned by Organizations", () => {
  let pg: PGlite;
  let db: Database;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    await seedAgencyDaos(db, [{ id: "alpha-org", daoAccountId: ALPHA_DAO }]);
  });

  afterAll(async () => {
    await pg.close();
  });

  function workspace(seed: ReturnType<typeof project>[] = []) {
    const { plugins, directory, projects } = inMemoryProjectsPlugin(seed);
    const access = inMemoryAccess(db, {
      organizations: [
        { id: "studio" },
        { id: "alpha-org", daoAccountId: ALPHA_DAO },
        { id: "rival" },
      ],
      members: [
        { userId: "founder", organizationId: "studio", role: "owner" },
        { userId: "designer", organizationId: "studio", role: "member" },
        { userId: "alpha-admin", organizationId: "alpha-org", role: "admin" },
        { userId: "rival-admin", organizationId: "rival", role: "admin" },
      ],
    });
    const listings = createListingsService(db, directory);
    const agency = createAgencyService(
      db,
      plugins,
      directory,
      listings,
      createProjectLedgers(db, listings),
    );
    const scopeOf = (userId: string, organizationId: string, near?: string) =>
      access.agencyScope(signedIn(userId, organizationId, near), ROLE_MATRIX.work);
    return { access, agency, projects, scopeOf };
  }

  describe("an Organization without an Agency DAO", () => {
    test("creates, edits and lists its own Projects", async () => {
      const { agency, scopeOf } = workspace();
      const founder = await scopeOf("founder", "studio", "founder.near");

      const { project: created } = await runEffect(
        agency.createProject(founder, {
          slug: "studio-site",
          title: "Studio site",
          repository: "https://github.com/studio/site",
        }),
      );
      const { project: renamed } = await runEffect(
        agency.updateProject(founder, { id: created.id, title: "Studio website" }),
      );
      const listed = await runEffect(agency.listProjects(founder));

      expect(created.organizationId).toBe("studio");
      expect(renamed.title).toBe("Studio website");
      expect(listed.data.map((p) => p.slug)).toEqual(["studio-site"]);
    });

    test("its members see Projects created by other members", async () => {
      const { agency, scopeOf } = workspace();
      const founder = await scopeOf("founder", "studio");
      await runEffect(
        agency.createProject(founder, {
          slug: "internal-tool",
          title: "Internal tool",
          repository: "https://github.com/studio/tool",
        }),
      );

      const designer = await scopeOf("designer", "studio");

      expect((await runEffect(agency.listProjects(designer))).data.map((p) => p.slug)).toEqual([
        "internal-tool",
      ]);
    });

    test("is refused money operations with a clear reason", async () => {
      const { scopeOf } = workspace();
      const founder = await scopeOf("founder", "studio");

      expect(() => requireTreasury(founder)).toThrow(
        expect.objectContaining({
          code: "FORBIDDEN",
          message: expect.stringContaining("Connect a treasury"),
          data: { reason: NO_AGENCY_DAO },
        }),
      );
    });
  });

  describe("other Organizations", () => {
    test("cannot see, edit or delete another Organization's Projects", async () => {
      const { agency, scopeOf } = workspace([project("studio-private", "studio")]);
      const rival = await scopeOf("rival-admin", "rival");

      expect((await runEffect(agency.listProjects(rival))).data).toEqual([]);
      await expect(
        runEffect(agency.updateProject(rival, { id: "studio-private", title: "Taken" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        runEffect(agency.deleteProject(rival, { id: "studio-private" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("mentions", () => {
    test("a new scope mentions its parent by the parent's owner", async () => {
      const parent = { ...project("parent", "studio"), ownerId: "creator.near", slug: "platform" };
      const { agency, scopeOf, projects } = workspace([parent]);
      const founder = await scopeOf("founder", "studio");

      await runEffect(
        agency.createProject(founder, {
          slug: "platform-scope",
          title: "Scope",
          kind: "scope",
          parentSlug: "platform",
          description: "Phase one",
        }),
      );

      expect(projects.find((p) => p.slug === "platform-scope")?.content).toBe(
        "@creator.near/platform\n\nPhase one",
      );
    });
  });

  describe("during the ownership migration", () => {
    test("an Organization with an Agency DAO still lists Projects keyed by that DAO", async () => {
      const { agency, scopeOf } = workspace([
        project("legacy", ALPHA_DAO),
        project("migrated", "alpha-org"),
      ]);
      const admin = await scopeOf("alpha-admin", "alpha-org");

      const listed = await runEffect(agency.listProjects(admin));

      expect(listed.data.map((p) => p.id).sort()).toEqual(["legacy", "migrated"]);
    });
  });
});
