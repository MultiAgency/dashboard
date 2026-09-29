import { beforeEach, describe, expect, test } from "vitest";
import { organizationDaos } from "../../src/db/schema";
import { createOrganizationCleanup } from "../../src/services/organization-cleanup";
import { type FakeOrganization, inMemoryOrganizations } from "../fakes/organizations";
import { migratedDatabase } from "./_pg";

const MULTIAGENCY = "multiagency.sputnik-dao.near";
const OTHER = "other.sputnik-dao.near";

describe("organization cleanup", () => {
  const database = migratedDatabase();

  beforeEach(async () => {
    await database.pg.query("TRUNCATE organization_daos");
  });

  const duplicated: FakeOrganization[] = [
    { id: "test-copy", daoAccountId: MULTIAGENCY, createdAt: "2026-03-01T00:00:00.000Z" },
    { id: "multiagency", daoAccountId: MULTIAGENCY, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "another-copy", daoAccountId: MULTIAGENCY, createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "other", daoAccountId: OTHER },
    { id: "client-org" },
    { id: "personal", daoAccountId: MULTIAGENCY, isPersonal: true },
  ];

  function cleanupWith() {
    const fake = inMemoryOrganizations({ organizations: duplicated });
    const cleanup = createOrganizationCleanup({ db: database.db, organizations: fake.port });
    return { fake, cleanup };
  }

  async function stateOf(fake: ReturnType<typeof cleanupWith>["fake"]) {
    const mapped = await database.db.select().from(organizationDaos);
    return {
      organizations: fake.ids(),
      mappings: mapped.map((r) => [r.organizationId, r.daoAccountId]).sort(),
    };
  }

  test("keeps the oldest Organization of a duplicated Agency DAO and maps every Agency DAO", async () => {
    const { fake, cleanup } = cleanupWith();

    const report = await cleanup.run();

    expect(report.removedOrganizations.sort()).toEqual(["another-copy", "test-copy"]);
    expect(await stateOf(fake)).toEqual({
      organizations: ["client-org", "multiagency", "other", "personal"],
      mappings: [
        ["multiagency", MULTIAGENCY],
        ["other", OTHER],
      ],
    });
  });

  test("keeps the Organization already mapped to the Agency DAO", async () => {
    await database.db
      .insert(organizationDaos)
      .values({ organizationId: "test-copy", daoAccountId: MULTIAGENCY });
    const { fake, cleanup } = cleanupWith();

    await cleanup.run();

    expect(await stateOf(fake)).toMatchObject({
      organizations: ["client-org", "other", "personal", "test-copy"],
      mappings: [
        ["other", OTHER],
        ["test-copy", MULTIAGENCY],
      ],
    });
  });

  test("running it again changes nothing", async () => {
    const { fake, cleanup } = cleanupWith();
    await cleanup.run();
    const cleaned = await stateOf(fake);

    expect(await cleanup.run()).toEqual({
      removedOrganizations: [],
      mappedOrganizations: [],
    });
    expect(await stateOf(fake)).toEqual(cleaned);
  });

  test("a dry run reports the changes a real run makes without making them", async () => {
    const { fake, cleanup } = cleanupWith();
    const before = await stateOf(fake);

    const dryRun = await cleanup.run({ dryRun: true });

    expect(await stateOf(fake)).toEqual(before);
    expect(dryRun).toEqual(await cleanup.run());
  });
});
