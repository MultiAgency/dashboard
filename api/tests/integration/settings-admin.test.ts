import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  getResolvedPublicSettings,
  getSettingsRow,
  upsertSettings,
} from "../../src/services/settings-admin";
import { applyAllMigrations } from "./_pg";

const FIELDS_EMPTY = {
  nearnAccountId: null,
  websiteUrl: null,
  docsUrl: null,
  description: null,
  contactEmail: null,
};

const DEFAULT_DAO = "agency.sputnik-dao.near";
const DEFAULT_ORG = { organizationId: "agency-org", agencyDao: DEFAULT_DAO };
const OTHER_ORG = { organizationId: "other-org", agencyDao: null };

describe("settings-admin (integration)", () => {
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

  test("returns null when the Organization has no settings", async () => {
    expect(await getSettingsRow(db as never, DEFAULT_ORG)).toBeNull();
  });

  test("upsert keys settings by Organization id with created+updated audit", async () => {
    await upsertSettings(
      db as never,
      DEFAULT_ORG.organizationId,
      { ...FIELDS_EMPTY, nearnAccountId: "agency", contactEmail: "hello@agency.example" },
      "admin.near",
    );
    const row = await getSettingsRow(db as never, DEFAULT_ORG);
    expect(row?.orgAccountId).toBe("agency-org");
    expect(row?.nearnAccountId).toBe("agency");
    expect(row?.contactEmail).toBe("hello@agency.example");
    expect(row?.createdBy).toBe("admin.near");
    expect(row?.updatedBy).toBe("admin.near");
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  test("upsert preserves createdBy/createdAt on subsequent updates", async () => {
    await upsertSettings(
      db as never,
      DEFAULT_ORG.organizationId,
      { ...FIELDS_EMPTY, nearnAccountId: "first" },
      "first-admin.near",
    );
    const first = await getSettingsRow(db as never, DEFAULT_ORG);
    const firstCreatedAt = first?.createdAt.getTime();
    await new Promise((r) => setTimeout(r, 5));

    await upsertSettings(
      db as never,
      DEFAULT_ORG.organizationId,
      { ...FIELDS_EMPTY, nearnAccountId: "second" },
      "second-admin.near",
    );
    const second = await getSettingsRow(db as never, DEFAULT_ORG);
    expect(second?.createdBy).toBe("first-admin.near");
    expect(second?.createdAt.getTime()).toBe(firstCreatedAt);
    expect(second?.updatedBy).toBe("second-admin.near");
    expect(second?.nearnAccountId).toBe("second");
  });

  test("public settings fall back to defaults and name the default Agency DAO", async () => {
    const resolved = await getResolvedPublicSettings(db as never, "mainnet", DEFAULT_ORG);

    expect(resolved.name).toBe("MultiAgency");
    expect(resolved.orgAccountId).toBe(DEFAULT_DAO);
    expect(resolved.nearnAccountId).toBe("multiagency");
  });

  test("public settings read the default Organization's row, not the first row", async () => {
    await upsertSettings(
      db as never,
      OTHER_ORG.organizationId,
      { ...FIELDS_EMPTY, nearnAccountId: "other", websiteUrl: "https://other.example" },
      "other-admin",
    );
    await upsertSettings(
      db as never,
      DEFAULT_ORG.organizationId,
      {
        nearnAccountId: "agency",
        websiteUrl: "https://agency.example",
        docsUrl: "https://docs.agency.example",
        description: "test pitch",
        contactEmail: "hi@agency.example",
      },
      "admin.near",
    );

    const resolved = await getResolvedPublicSettings(db as never, "mainnet", DEFAULT_ORG);

    expect(resolved).toMatchObject({
      orgAccountId: DEFAULT_DAO,
      nearnAccountId: "agency",
      websiteUrl: "https://agency.example",
      docsUrl: "https://docs.agency.example",
      description: "test pitch",
      contactEmail: "hi@agency.example",
      name: "MultiAgency",
      headline: "Open Books · Open Source · Open Doors",
    });
  });

  test("a row still keyed by the Agency DAO is read until it is re-keyed", async () => {
    await upsertSettings(
      db as never,
      DEFAULT_DAO,
      { ...FIELDS_EMPTY, nearnAccountId: "legacy" },
      "admin.near",
    );

    expect((await getSettingsRow(db as never, DEFAULT_ORG))?.nearnAccountId).toBe("legacy");

    await upsertSettings(
      db as never,
      DEFAULT_ORG.organizationId,
      { ...FIELDS_EMPTY, nearnAccountId: "current" },
      "admin.near",
    );

    expect((await getSettingsRow(db as never, DEFAULT_ORG))?.nearnAccountId).toBe("current");
  });
});
