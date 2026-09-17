import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { createListingsService } from "../../src/services/listings";
import { createProjectDirectory } from "../../src/services/project-directory";
import { agencyScope, inMemoryProjects, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA = "alpha.sputnik-dao.near";
const BETA = "beta.sputnik-dao.near";

describe("internal listings", () => {
  let pg: PGlite;
  let db: Database;
  const scope = agencyScope(ALPHA);
  const directory = createProjectDirectory(
    () => inMemoryProjects([project("alpha-project", ALPHA), project("beta-project", BETA)]).client,
  );
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

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

  const draft = {
    projectId: "alpha-project",
    title: "Build the site",
    type: "Bounty" as const,
    token: "USDT",
    rewardAmount: "25",
  };

  test("a listing starts as a draft and moves through its lifecycle", async () => {
    const listings = createListingsService(db, directory);

    const created = await run(listings.createInternal(scope, draft));
    expect(created.listing.lifecycle).toBe("draft");

    const published = await run(
      listings.updateInternal(scope, { projectId: "alpha-project", lifecycle: "published" }),
    );
    expect(published.listing).toMatchObject({ lifecycle: "published", isPublished: true });

    const fetched = await run(listings.getInternal(scope, "alpha-project"));
    expect(fetched.listing?.lifecycle).toBe("published");
  });

  test("lifecycle transitions outside the allowed paths are rejected", async () => {
    const listings = createListingsService(db, directory);
    await run(listings.createInternal(scope, { ...draft, lifecycle: "archived" }));

    await expect(
      run(
        listings.updateInternal(scope, {
          projectId: "alpha-project",
          lifecycle: "winners_announced",
        }),
      ),
    ).rejects.toThrow("Cannot move listing from archived to winners_announced");

    const unchanged = await run(listings.getInternal(scope, "alpha-project"));
    expect(unchanged.listing?.lifecycle).toBe("archived");
  });

  test("updating or deleting a missing listing is NOT_FOUND", async () => {
    const listings = createListingsService(db, directory);

    await expect(
      run(listings.updateInternal(scope, { projectId: "alpha-project", title: "x" })),
    ).rejects.toThrow("No internal listing exists for this project");
    await expect(run(listings.deleteInternal(scope, "alpha-project"))).rejects.toThrow(
      "No internal listing exists for this project",
    );
  });

  test("another agency's project listings are out of reach", async () => {
    const listings = createListingsService(db, directory);

    await expect(
      run(listings.createInternal(scope, { ...draft, projectId: "beta-project" })),
    ).rejects.toThrow("Project not found");
    await expect(run(listings.getInternal(scope, "beta-project"))).rejects.toThrow(
      "Project not found",
    );
  });
});
