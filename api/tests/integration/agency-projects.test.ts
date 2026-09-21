import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { listings } from "../../src/db/schema";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createProjectLedgers } from "../../src/services/ledger";
import { createListingsService } from "../../src/services/listings";
import { createProjectDirectory } from "../../src/services/project-directory";
import { agencyScope, inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const AGENCY = "alpha.sputnik-dao.near";

describe("agency projects", () => {
  let pg: PGlite;
  let db: Database;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query("TRUNCATE listings");
  });

  afterAll(async () => {
    await pg.close();
  });

  function agencyWith(projects: ReturnType<typeof project>[]) {
    const { client } = inMemoryProjects(projects);
    const plugins = {
      projects: () => ({
        ...client,
        createProject: async (input: {
          slug: string;
          title: string;
          organizationId: string;
          visibility: string;
        }) => {
          const created = {
            ...project(`created-${input.slug}`, input.organizationId),
            slug: input.slug,
            title: input.title,
            visibility: input.visibility as "private",
          };
          projects.push(created);
          return created;
        },
        updateProject: async ({ id }: { id: string }) => projects.find((p) => p.id === id)!,
      }),
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
    } as unknown as PluginsClient;
    const directory = createProjectDirectory(() => client);
    const listingsService = createListingsService(db, directory);
    return createAgencyService(
      db,
      plugins,
      directory,
      listingsService,
      createProjectLedgers(db, listingsService),
    );
  }

  test("attaching a NEARN listing already used elsewhere names the other project", async () => {
    const agency = agencyWith([
      { ...project("site", AGENCY), title: "Website" },
      project("app", AGENCY),
    ]);
    await db.insert(listings).values({
      id: crypto.randomUUID(),
      projectId: "site",
      source: "nearn",
      externalId: "build-a-site",
    });

    const outcome = await Effect.runPromise(
      Effect.either(
        agency.updateProject(agencyScope(AGENCY), { id: "app", nearnListingId: "build-a-site" }),
      ),
    );

    expect(outcome._tag).toBe("Left");
    expect(outcome._tag === "Left" && outcome.left).toMatchObject({
      code: "BAD_REQUEST",
      message:
        'NEARN listing "build-a-site" is already attached to Website (@slug-site); detach there first.',
    });
  });

  test("a project opens by slug for members but stays hidden from visitors while private", async () => {
    const agency = agencyWith([project("site", AGENCY), project("other", "beta.sputnik-dao.near")]);
    const visitor = agencyScope(AGENCY, { role: null, canSeePrivate: false });

    const opened = await Effect.runPromise(agency.getProject(agencyScope(AGENCY), "slug-site"));
    expect(opened.project).toMatchObject({ id: "site", nearnListingId: null });

    for (const [scope, slug] of [
      [visitor, "slug-site"],
      [agencyScope(AGENCY), "slug-other"],
    ] as const) {
      const outcome = await Effect.runPromise(Effect.either(agency.getProject(scope, slug)));
      expect(outcome._tag === "Left" && outcome.left).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  test("an Organization without an Agency DAO creates and lists its own Projects", async () => {
    const agency = agencyWith([project("theirs", "org-other")]);
    const indie = orgScope("org-indie");

    const { project: created } = await Effect.runPromise(
      agency.createProject(indie, { slug: "first", title: "First" }),
    );
    const listed = await Effect.runPromise(agency.listProjects(indie));

    expect(created).toMatchObject({ organizationId: "org-indie", slug: "first" });
    expect(listed.data.map((p) => p.slug)).toEqual(["first"]);
  });

  test("Projects still owned by the Agency DAO stay visible to its Organization", async () => {
    const agency = agencyWith([
      project("legacy", AGENCY),
      project("current", "org-alpha"),
      project("foreign", "org-beta"),
    ]);
    const alpha = agencyScope(AGENCY, { organizationId: "org-alpha" });

    const listed = await Effect.runPromise(agency.listProjects(alpha));
    const opened = await Effect.runPromise(agency.getProject(alpha, "slug-legacy"));

    expect(listed.data.map((p) => p.id).sort()).toEqual(["current", "legacy"]);
    expect(opened.project.id).toBe("legacy");
  });
});
