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

const MAINNET_ORG = "agency.sputnik-dao.near";
const TESTNET_ORG = "agency.sputnikv2.testnet";

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

  test("returns null when no row exists for the orgAccountId", async () => {
    const row = await getSettingsRow(db as never, MAINNET_ORG);
    expect(row).toBeNull();
  });

  test("upsert inserts a new row with created+updated audit set to inserter", async () => {
    await upsertSettings(
      db as never,
      MAINNET_ORG,
      {
        ...FIELDS_EMPTY,
        nearnAccountId: "agency",
        contactEmail: "hello@agency.example",
      },
      "admin.near",
    );
    const row = await getSettingsRow(db as never, MAINNET_ORG);
    expect(row?.orgAccountId).toBe(MAINNET_ORG);
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
      MAINNET_ORG,
      { ...FIELDS_EMPTY, nearnAccountId: "first" },
      "first-admin.near",
    );
    const first = await getSettingsRow(db as never, MAINNET_ORG);
    expect(first?.createdBy).toBe("first-admin.near");
    const firstCreatedAt = first?.createdAt.getTime();

    // Ensure clock moves so updatedAt would differ
    await new Promise((r) => setTimeout(r, 5));

    await upsertSettings(
      db as never,
      MAINNET_ORG,
      { ...FIELDS_EMPTY, nearnAccountId: "second" },
      "second-admin.near",
    );
    const second = await getSettingsRow(db as never, MAINNET_ORG);
    // created* unchanged
    expect(second?.createdBy).toBe("first-admin.near");
    expect(second?.createdAt.getTime()).toBe(firstCreatedAt);
    // updated* moved to the new actor
    expect(second?.updatedBy).toBe("second-admin.near");
    expect(second?.nearnAccountId).toBe("second");
  });

  test("rows for different orgAccountIds are isolated", async () => {
    await upsertSettings(
      db as never,
      MAINNET_ORG,
      { ...FIELDS_EMPTY, nearnAccountId: "main" },
      "admin.near",
    );
    await upsertSettings(
      db as never,
      TESTNET_ORG,
      { ...FIELDS_EMPTY, nearnAccountId: "test" },
      "tester.testnet",
    );
    const m = await getSettingsRow(db as never, MAINNET_ORG);
    const t = await getSettingsRow(db as never, TESTNET_ORG);
    expect(m?.nearnAccountId).toBe("main");
    expect(t?.nearnAccountId).toBe("test");
  });

  test("getResolvedPublicSettings merges DB over env/hardcoded for editable fields", async () => {
    const before = await getResolvedPublicSettings(db as never, "mainnet");
    expect(before.name).toBe("MultiAgency");
    expect(before.orgAccountId).toBeNull();
    expect(before.nearnAccountId).toBe("multiagency");

    await upsertSettings(
      db as never,
      MAINNET_ORG,
      {
        nearnAccountId: "agency",
        websiteUrl: "https://agency.example",
        docsUrl: "https://docs.agency.example",
        description: "test pitch",
        contactEmail: "hi@agency.example",
      },
      "admin.near",
    );
    const after = await getResolvedPublicSettings(db as never, "mainnet");
    expect(after.orgAccountId).toBe(MAINNET_ORG);
    expect(after.nearnAccountId).toBe("agency");
    expect(after.websiteUrl).toBe("https://agency.example");
    expect(after.docsUrl).toBe("https://docs.agency.example");
    expect(after.description).toBe("test pitch");
    expect(after.contactEmail).toBe("hi@agency.example");
    expect(after.name).toBe("MultiAgency");
    expect(after.headline).toBe("Open Books · Open Source · Open Doors");
  });

  test("getResolvedPublicSettings uses the stored settings row when present", async () => {
    await upsertSettings(
      db as never,
      TESTNET_ORG,
      {
        ...FIELDS_EMPTY,
        nearnAccountId: "testnet-only",
        websiteUrl: "https://testnet.example",
      },
      "testadmin.testnet",
    );
    const resolved = await getResolvedPublicSettings(db as never, "mainnet");
    expect(resolved.orgAccountId).toBe(TESTNET_ORG);
    expect(resolved.nearnAccountId).toBe("testnet-only");
    expect(resolved.websiteUrl).toBe("https://testnet.example");
  });

  test("orgAccountId is the row's immutable identity — cannot be changed via upsert", async () => {
    // upsertSettings is keyed by orgAccountId; calling it with a different orgAccountId creates a
    // NEW row rather than mutating the existing one. This is the multi-tenant-native semantic.
    await upsertSettings(
      db as never,
      MAINNET_ORG,
      { ...FIELDS_EMPTY, nearnAccountId: "first" },
      "admin.near",
    );
    await upsertSettings(
      db as never,
      "different.sputnik-dao.near",
      { ...FIELDS_EMPTY, nearnAccountId: "second" },
      "admin.near",
    );
    const first = await getSettingsRow(db as never, MAINNET_ORG);
    const second = await getSettingsRow(db as never, "different.sputnik-dao.near");
    expect(first?.nearnAccountId).toBe("first");
    expect(second?.nearnAccountId).toBe("second");
  });
});
