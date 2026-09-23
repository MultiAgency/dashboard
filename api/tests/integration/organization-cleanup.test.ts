import type { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runOrganizationCleanup } from "../../../scripts/cleanup-organizations";
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
        name text,
        slug text,
        metadata jsonb,
        "createdAt" timestamptz NOT NULL
      );
      CREATE TABLE invitation ("organizationId" text);
      CREATE TABLE member ("organizationId" text, "userId" text);
      CREATE TABLE session ("activeOrganizationId" text);
      CREATE TABLE projects (
        id text PRIMARY KEY,
        organization_id text NOT NULL
      );
      INSERT INTO organization (id, name, slug, metadata, "createdAt") VALUES
        ('org-keep', 'Kept Agency', 'keep', '{"daoAccountId":"shared.sputnik-dao.near"}', '2026-01-01'),
        ('org-drop', 'Duplicate Agency', 'drop', '{"daoAccountId":"shared.sputnik-dao.near"}', '2026-02-01'),
        ('org-other', 'Other Agency', 'other', '{"daoAccountId":"other.sputnik-dao.near"}', '2026-01-01'),
        ('org-client', 'Client', 'client', '{}', '2026-01-01');
      INSERT INTO projects (id, organization_id) VALUES ('proj-live', 'shared.sputnik-dao.near');
      INSERT INTO clients (id, org_id, agency_dao_account_id, name)
        VALUES ('c-1', 'org-client', 'shared.sputnik-dao.near', 'Client');
      INSERT INTO client_projects (client_id, project_id) VALUES
        ('c-1', 'proj-live'),
        ('c-1', 'proj-gone');
    `);
    const query = (sql: string, params?: unknown[]) => pg.query(sql, params);
    const pool = {
      query,
      connect: async () => ({ query, release: () => {} }),
    } as unknown as pg.Pool;
    await runOrganizationCleanup({ auth: pool, api: pool, projects: pool, apply: true });
    await applyMigrations(pg, CLIENTS_AS_ORGANIZATIONS);
  });

  afterAll(async () => {
    await pg.close();
  });

  test("keeps the oldest organization for a shared DAO and shares only live projects", async () => {
    const orgs = await pg.query<{ id: string }>("SELECT id FROM organization ORDER BY id");
    expect(orgs.rows.map((row) => row.id)).toEqual(["org-client", "org-keep", "org-other"]);

    const projects = await pg.query<{ organization_id: string }>(
      "SELECT organization_id FROM projects WHERE id = 'proj-live'",
    );
    expect(projects.rows[0]?.organization_id).toBe("org-keep");

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
