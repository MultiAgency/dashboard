import { beforeAll, describe, expect, test } from "vitest";
import { runEffect } from "../../src/lib/context";
import { createAgencyService } from "../../src/services/agency";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { ROLE_MATRIX } from "../../src/services/organization-access";
import { inMemoryAccess, seedAgencyDaos, signedIn } from "../fakes/organizations";
import { inMemoryProjectsPlugin, project } from "../fakes/projects";
import { migratedDatabase } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.testnet";

describe("Projects owned by Organizations", () => {
  const state = migratedDatabase();
  const ORGANIZATIONS = [
    { id: "studio" },
    { id: "alpha-org", daoAccountId: ALPHA_DAO },
    { id: "rival" },
  ];

  beforeAll(() => seedAgencyDaos(state.db, ORGANIZATIONS));

  function workspace(seed: ReturnType<typeof project>[] = []) {
    const { plugins, directory, projects } = inMemoryProjectsPlugin(seed);
    const { db } = state;
    const access = inMemoryAccess(db, {
      organizations: ORGANIZATIONS,
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

  test("an Organization without an Agency DAO creates, edits and lists Projects for all its members", async () => {
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
    const designer = await scopeOf("designer", "studio");

    expect(created.organizationId).toBe("studio");
    expect(renamed.title).toBe("Studio website");
    for (const scope of [founder, designer]) {
      expect((await runEffect(agency.listProjects(scope))).data.map((p) => p.slug)).toEqual([
        "studio-site",
      ]);
    }
  });

  test("other Organizations cannot see, edit or delete its Projects", async () => {
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

  test("Projects still keyed by the Organization's Agency DAO are not listed", async () => {
    const { agency, scopeOf } = workspace([
      project("unmigrated", ALPHA_DAO),
      project("migrated", "alpha-org"),
    ]);
    const admin = await scopeOf("alpha-admin", "alpha-org");

    const listed = await runEffect(agency.listProjects(admin));

    expect(listed.data.map((p) => p.id)).toEqual(["migrated"]);
  });
});
