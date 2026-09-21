import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyMigrations } from "./_pg";

const BEFORE = (file: string) => file < "0005_clients_as_organizations";
const CLIENTS_AS_ORGANIZATIONS = (file: string) => file.startsWith("0005_clients_as_organizations");

describe("organization cleanup migration", () => {
  let pg: PGlite;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyMigrations(pg, BEFORE);
    await pg.exec(`
      CREATE TABLE organization (
        id text PRIMARY KEY,
        slug text,
        metadata jsonb,
        "createdAt" timestamptz NOT NULL
      );
      CREATE TABLE projects (
        id text PRIMARY KEY
      );
      INSERT INTO organization (id, slug, metadata, "createdAt") VALUES
        ('org-keep', 'keep', '{"daoAccountId":"shared.sputnik-dao.near"}', '2026-01-01'),
        ('org-drop', 'drop', '{"daoAccountId":"shared.sputnik-dao.near"}', '2026-02-01'),
        ('org-other', 'other', '{"daoAccountId":"other.sputnik-dao.near"}', '2026-01-01');
      INSERT INTO projects (id) VALUES ('proj-live');
      INSERT INTO clients (id, org_id, agency_dao_account_id, name)
        VALUES ('c-1', 'org-keep', 'shared.sputnik-dao.near', 'Kept');
      INSERT INTO client_projects (client_id, project_id) VALUES
        ('c-1', 'proj-live'),
        ('c-1', 'proj-gone');
    `);
    await applyMigrations(pg, CLIENTS_AS_ORGANIZATIONS);
  });

  afterAll(async () => {
    await pg.close();
  });

  test("keeps the oldest organization for a shared DAO and shares only live projects", async () => {
    const orgs = await pg.query<{ id: string }>("SELECT id FROM organization ORDER BY id");
    expect(orgs.rows.map((row) => row.id)).toEqual(["org-keep", "org-other"]);

    const engagementLinks = await pg.query<{ project_id: string }>(
      "SELECT project_id FROM engagement_projects ORDER BY project_id",
    );
    expect(engagementLinks.rows.map((row) => row.project_id)).toEqual(["proj-live"]);

    const clients = await pg.query<{ exists: boolean }>(
      "SELECT to_regclass('public.clients') IS NOT NULL AS exists",
    );
    expect(clients.rows[0]?.exists).toBe(false);
  });
});