import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyMigrations } from "./_pg";

const BEFORE = (file: string) => file < "0006";
const ENGAGEMENTS = (file: string) => file.startsWith("0006");

describe("migrating Clients to Engagements", () => {
  let pg: PGlite;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyMigrations(pg, BEFORE);
    await pg.exec(`
      INSERT INTO organization_daos (organization_id, dao_account_id)
        VALUES ('org-multiagency', 'multiagency.sputnik-dao.near');
      INSERT INTO clients (id, org_id, agency_dao_account_id, name, near_account_id) VALUES
        ('c-nf', 'org-nf', 'multiagency.sputnik-dao.near', 'NEAR Foundation', 'work.efiz.near'),
        ('c-other', 'org-other', 'other.sputnik-dao.near', 'Other Client', null);
      INSERT INTO client_projects (client_id, project_id) VALUES
        ('c-nf', 'proj-a'), ('c-nf', 'proj-b'), ('c-other', 'proj-c');
    `);
    await applyMigrations(pg, ENGAGEMENTS);
  });

  afterAll(async () => {
    await pg.close();
  });

  test("each Client becomes an active Engagement with its Projects shared", async () => {
    const { rows } = await pg.query<{
      agency_organization_id: string;
      client_organization_id: string;
      client_name: string;
      status: string;
      projects: string[];
    }>(`
      SELECT e.agency_organization_id, e.client_organization_id, e.client_name, e.status,
        array_agg(ep.project_id ORDER BY ep.project_id) AS projects
      FROM engagements e JOIN engagement_projects ep ON ep.engagement_id = e.id
      GROUP BY e.id ORDER BY e.client_name
    `);

    expect(rows).toEqual([
      {
        agency_organization_id: "org-multiagency",
        client_organization_id: "org-nf",
        client_name: "NEAR Foundation",
        status: "active",
        projects: ["proj-a", "proj-b"],
      },
      {
        agency_organization_id: "other.sputnik-dao.near",
        client_organization_id: "org-other",
        client_name: "Other Client",
        status: "active",
        projects: ["proj-c"],
      },
    ]);
  });
});
