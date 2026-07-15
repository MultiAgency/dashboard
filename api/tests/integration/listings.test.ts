import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { listings as listingsTable } from "../../src/db/schema";
import {
  attachNearnListing,
  createInternalListing,
  deleteInternalListing,
  detachNearnListing,
  refreshNearnListing,
  setListingsArchived,
  updateInternalListing,
} from "../../src/services/listings";
import type { NearnListing } from "../../src/services/nearn";
import { applyAllMigrations } from "./_pg";

const PROJECT_A = "00000000-0000-0000-0000-00000000000a";
const PROJECT_B = "00000000-0000-0000-0000-00000000000b";
const MAINNET_ORG = "agency.sputnik-dao.near";

let slugCounter = 0;
function uniqueSlug(): string {
  slugCounter += 1;
  return `listing-${slugCounter}-${Date.now()}`;
}

function sample(slug: string, overrides: Partial<NearnListing> = {}): NearnListing {
  return {
    id: "0e6ba6ef-6e50-4149-89fe-f16f531e79cf",
    slug,
    title: "Build portal",
    description: "desc",
    type: "Project",
    status: "OPEN",
    token: "NEAR",
    rewardAmount: 100,
    compensationType: "fixed",
    minRewardAsk: null,
    maxRewardAsk: null,
    submissionLimit: "single",
    totalPaymentsMade: null,
    totalWinnersSelected: null,
    rewards: null,
    maxBonusSpots: null,
    usdValue: null,
    skills: null,
    region: null,
    applicationType: null,
    multipleSubmissionRule: null,
    timeToComplete: null,
    requirements: null,
    sequentialId: null,
    nearnPublishedAt: null,
    isFeatured: null,
    isPrivate: null,
    isHackathonPrize: null,
    hackathonSlug: null,
    hackathonName: null,
    hackathonStartDate: null,
    hackathonAnnounceDate: null,
    deadline: null,
    isPublished: true,
    isArchived: false,
    isWinnersAnnounced: false,
    sponsor: {
      name: "Agency",
      slug: "agency",
      logo: null,
      isVerified: true,
      entityName: null,
      isCaution: null,
    },
    ...overrides,
  };
}

function nearnResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("listings cache invalidation", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await pg.close();
  });

  test("attachNearnListing inserts a fresh row keyed by (projectId, source)", async () => {
    const slug = uniqueSlug();
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slug)))) as never;
    const row = await attachNearnListing(PROJECT_A, slug, db as never);
    expect(row.projectId).toBe(PROJECT_A);
    expect(row.source).toBe("nearn");
    expect(row.externalId).toBe(slug);
    expect(row.title).toBe("Build portal");
    expect(row.isArchived).toBe(false);
  });

  test("attachNearnListing upserts on (projectId, source) — same project re-attach updates in place", async () => {
    const slug1 = uniqueSlug();
    const slug2 = uniqueSlug();
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slug1)))) as never;
    const first = await attachNearnListing(PROJECT_A, slug1, db as never);

    globalThis.fetch = vi.fn(() =>
      Promise.resolve(nearnResponse(sample(slug2, { title: "Redesign portal" }))),
    ) as never;
    const second = await attachNearnListing(PROJECT_A, slug2, db as never);

    expect(second.id).toBe(first.id);
    expect(second.externalId).toBe(slug2);
    expect(second.title).toBe("Redesign portal");

    const rows = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.projectId, PROJECT_A));
    expect(rows).toHaveLength(1);
  });

  test("detachNearnListing removes only the NEARN-source row for that project", async () => {
    const slugA = uniqueSlug();
    const slugB = uniqueSlug();
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slugA)))) as never;
    await attachNearnListing(PROJECT_A, slugA, db as never);
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slugB)))) as never;
    await attachNearnListing(PROJECT_B, slugB, db as never);

    await detachNearnListing(PROJECT_A, db as never);

    const a = await db.select().from(listingsTable).where(eq(listingsTable.projectId, PROJECT_A));
    const b = await db.select().from(listingsTable).where(eq(listingsTable.projectId, PROJECT_B));
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  test("refreshNearnListing returns null when no row matches the slug", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("RPC should not be called"))) as never;
    const result = await refreshNearnListing("nonexistent", MAINNET_ORG, db as never);
    expect(result).toBeNull();
  });

  // refreshNearnListing tests seed the listings row via direct DB insert (not
  // attachNearnListing), so the per-slug fetch cache in nearn.ts stays cold and
  // the subsequent refresh actually triggers a network call.
  async function seedListingRow(projectId: string, slug: string) {
    await db.insert(listingsTable).values({
      id: crypto.randomUUID(),
      projectId,
      source: "nearn",
      externalId: slug,
      title: "Build portal",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      syncedAt: new Date(),
    });
  }

  test("refreshNearnListing flips isArchived=true on NEARN 404", async () => {
    const slug = uniqueSlug();
    await seedListingRow(PROJECT_A, slug);

    globalThis.fetch = vi.fn(() =>
      Promise.resolve(nearnResponse({ error: "not found" }, 404)),
    ) as never;
    const refreshed = await refreshNearnListing(slug, MAINNET_ORG, db as never);

    expect(refreshed?.isArchived).toBe(true);
    expect(refreshed?.externalId).toBe(slug);
  });

  test("refreshNearnListing on a testnet org returns the row unchanged (no fetch)", async () => {
    const slug = uniqueSlug();
    await seedListingRow(PROJECT_A, slug);

    const fetchSpy = vi.fn(() => Promise.reject(new Error("NEARN should not be hit on testnet")));
    globalThis.fetch = fetchSpy as never;

    const result = await refreshNearnListing(slug, "agency.sputnikv2.testnet", db as never);
    expect(result?.externalId).toBe(slug);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("refreshNearnListing updates cached fields on successful re-fetch", async () => {
    const slug = uniqueSlug();
    await seedListingRow(PROJECT_A, slug);

    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        nearnResponse(sample(slug, { title: "Build portal v2", isWinnersAnnounced: true })),
      ),
    ) as never;
    const refreshed = await refreshNearnListing(slug, MAINNET_ORG, db as never);
    expect(refreshed?.title).toBe("Build portal v2");
    expect(refreshed?.isWinnersAnnounced).toBe(true);

    const rows = await db
      .select()
      .from(listingsTable)
      .where(and(eq(listingsTable.projectId, PROJECT_A), eq(listingsTable.source, "nearn")));
    expect(rows).toHaveLength(1);
  });

  test("setListingsArchived flips both sources for one project, leaves siblings alone", async () => {
    const slugA = uniqueSlug();
    const slugB = uniqueSlug();

    // PROJECT_A: a NEARN listing and an internal listing.
    await db.insert(listingsTable).values({
      id: crypto.randomUUID(),
      projectId: PROJECT_A,
      source: "nearn",
      externalId: slugA,
      title: "A nearn",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      syncedAt: new Date(),
    });
    await db.insert(listingsTable).values({
      id: crypto.randomUUID(),
      projectId: PROJECT_A,
      source: "internal",
      externalId: null,
      title: "A internal",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      syncedAt: new Date(),
    });
    // PROJECT_B's listing must NOT be touched.
    await db.insert(listingsTable).values({
      id: crypto.randomUUID(),
      projectId: PROJECT_B,
      source: "nearn",
      externalId: slugB,
      title: "B nearn",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      syncedAt: new Date(),
    });

    await setListingsArchived(PROJECT_A, true, db as never);

    const a = await db.select().from(listingsTable).where(eq(listingsTable.projectId, PROJECT_A));
    const b = await db.select().from(listingsTable).where(eq(listingsTable.projectId, PROJECT_B));
    expect(a).toHaveLength(2);
    expect(a.every((r) => r.isArchived === true)).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0]?.isArchived).toBe(false);

    // Symmetric un-archive: project transitions back to active.
    await setListingsArchived(PROJECT_A, false, db as never);
    const aAfter = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.projectId, PROJECT_A));
    expect(aAfter.every((r) => r.isArchived === false)).toBe(true);
  });
});

describe("internal listings CRUD", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  test("createInternalListing inserts a row with source=internal and null externalId/syncedAt", async () => {
    const row = await createInternalListing(
      PROJECT_A,
      {
        title: "Build the agency portal",
        type: "Project",
        token: "NEAR",
        rewardAmount: "500",
        description: "Internal scope for the bootstrap sprint",
        isPublished: true,
      },
      db as never,
    );
    expect(row.projectId).toBe(PROJECT_A);
    expect(row.source).toBe("internal");
    expect(row.externalId).toBeNull();
    expect(row.syncedAt).toBeNull();
    expect(row.title).toBe("Build the agency portal");
    expect(row.type).toBe("Project");
    expect(row.token).toBe("NEAR");
    expect(row.rewardAmount).toBe("500");
    expect(row.isPublished).toBe(true);
    expect(row.isArchived).toBe(false);
    expect(row.isWinnersAnnounced).toBe(false);
  });

  test("createInternalListing rejects a second internal row for the same project (unique constraint)", async () => {
    await createInternalListing(
      PROJECT_A,
      { title: "First", type: "Bounty", token: "NEAR", rewardAmount: "100" },
      db as never,
    );
    await expect(
      createInternalListing(
        PROJECT_A,
        { title: "Second", type: "Bounty", token: "NEAR", rewardAmount: "200" },
        db as never,
      ),
    ).rejects.toThrow();
  });

  test("internal and NEARN rows coexist for the same project (per SPEC §82)", async () => {
    const slug = uniqueSlug();
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slug)))) as never;
    await attachNearnListing(PROJECT_A, slug, db as never);
    await createInternalListing(
      PROJECT_A,
      { title: "Internal", type: "Project", token: "NEAR", rewardAmount: "300" },
      db as never,
    );

    const rows = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.projectId, PROJECT_A));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(["internal", "nearn"]);
  });

  test("updateInternalListing partial-updates and bumps updatedAt", async () => {
    const created = await createInternalListing(
      PROJECT_A,
      { title: "Initial", type: "Bounty", token: "NEAR", rewardAmount: "100" },
      db as never,
    );
    const originalUpdatedAt = created.updatedAt;
    // Force a measurable updatedAt delta — pg's now() has sub-ms resolution but
    // the patch path explicitly sets `new Date()`, so a 5ms wait is enough.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await updateInternalListing(
      PROJECT_A,
      { isWinnersAnnounced: true, rewardAmount: "150" },
      db as never,
    );
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Initial");
    expect(updated?.isWinnersAnnounced).toBe(true);
    expect(updated?.rewardAmount).toBe("150");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  test("updateInternalListing with no patch fields returns the existing row unchanged", async () => {
    const created = await createInternalListing(
      PROJECT_A,
      { title: "Initial", type: "Bounty", token: "NEAR", rewardAmount: "100" },
      db as never,
    );
    const result = await updateInternalListing(PROJECT_A, {}, db as never);
    expect(result?.id).toBe(created.id);
    expect(result?.updatedAt.getTime()).toBe(created.updatedAt.getTime());
  });

  test("updateInternalListing returns null when no internal row exists for the project", async () => {
    const result = await updateInternalListing(PROJECT_A, { title: "Nope" }, db as never);
    expect(result).toBeNull();
  });

  test("deleteInternalListing removes only the internal-source row for that project", async () => {
    const slug = uniqueSlug();
    globalThis.fetch = vi.fn(() => Promise.resolve(nearnResponse(sample(slug)))) as never;
    await attachNearnListing(PROJECT_A, slug, db as never);
    await createInternalListing(
      PROJECT_A,
      { title: "Internal", type: "Project", token: "NEAR", rewardAmount: "100" },
      db as never,
    );

    const removed = await deleteInternalListing(PROJECT_A, db as never);
    expect(removed).toBe(true);

    const remaining = await db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.projectId, PROJECT_A));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.source).toBe("nearn");
  });

  test("deleteInternalListing returns false when no internal row exists", async () => {
    const removed = await deleteInternalListing(PROJECT_A, db as never);
    expect(removed).toBe(false);
  });
});
