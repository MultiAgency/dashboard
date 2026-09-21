import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Effect } from "every-plugin/effect";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { runEffect } from "../../src/lib/context";
import { createOrganizationAccess } from "../../src/lib/organization-access";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgentLinksService } from "../../src/services/agent-links";
import { createClientPortalService } from "../../src/services/client-portal";
import { createEngagementsService } from "../../src/services/engagements";
import type { IdeaProjects } from "../../src/services/ideas";
import { createIdeasService } from "../../src/services/ideas";
import { createProjectDirectory, type PluginProject } from "../../src/services/project-directory";
import { createReportsService } from "../../src/services/reports";
import { inMemoryOrganizations } from "../fakes/organizations";
import { inMemoryProjects, orgScope, project } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const ALPHA_DAO = "alpha.sputnik-dao.near";

describe("client ideas, reports, and agent links", () => {
  let pg: PGlite;
  let db: Database;

  const alpha = orgScope("org-alpha", { agencyDao: ALPHA_DAO, actorId: "alpha.near" });
  const acme = orgScope("org-acme", { actorId: "acme.near" });
  const other = orgScope("org-other", { actorId: "other.near" });
  const stranger = orgScope("org-stranger");

  const seed: PluginProject[] = [project("site", "org-alpha"), project("internal", "org-alpha")];

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
  });

  beforeEach(async () => {
    await pg.query(
      "TRUNCATE engagements, engagement_projects, engagement_ideas, agent_links, budgets, billings, organization_daos CASCADE",
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  const run = <A, E>(effect: Effect.Effect<A, E>) => runEffect(effect);

  function services() {
    const projects = [...seed];
    const { client } = inMemoryProjects(projects);
    const directory = createProjectDirectory(() => client);
    const orgs = inMemoryOrganizations([
      { id: "org-alpha", name: "Alpha Agency", daoAccountId: ALPHA_DAO },
      { id: "org-acme", name: "Acme Corp" },
      { id: "org-other", name: "Other Client" },
    ]);
    const access = createOrganizationAccess(db, orgs.organizations, directory);
    const engagements = createEngagementsService(db, directory, orgs.organizations, access);
    const writer: IdeaProjects = {
      create: async (_context, input) => {
        const created = project(crypto.randomUUID(), input.organizationId);
        created.title = input.title;
        created.slug = input.slug;
        created.kind = "idea";
        created.description = input.description ?? null;
        created.content = input.content;
        projects.push(created);
        return {
          id: created.id,
          title: created.title,
          slug: created.slug,
          status: created.status,
          kind: created.kind,
          description: created.description,
          organizationId: created.organizationId,
        };
      },
      get: async (_context, id) => {
        const found = projects.find((row) => row.id === id);
        if (!found) return null;
        return {
          id: found.id,
          title: found.title,
          slug: found.slug,
          status: found.status,
          kind: found.kind,
          description: found.description,
          organizationId: found.organizationId,
        };
      },
    };
    const ideas = createIdeasService(db, engagements, writer);
    const links = createAgentLinksService(db, engagements);
    const plugins = {
      builders: () => ({ listBuilders: async () => ({ data: [] }) }),
    } as unknown as PluginsClient;
    const reports = createReportsService(db, directory, plugins);
    const portal = createClientPortalService(
      engagements,
      {} as never,
      {} as never,
      reports,
      directory,
      {} as never,
      access,
    );
    return { engagements, ideas, links, reports, portal, access, projects };
  }

  async function sharedEngagement(client: ReturnType<typeof orgScope>, projectId: string) {
    const { engagements } = services();
    const proposed = await run(
      engagements.propose(alpha, { clientOrganizationId: client.organizationId }),
    );
    const accepted = await run(engagements.accept(client, proposed.id));
    return run(engagements.share(alpha, { engagementId: accepted.id, projectId }));
  }

  test("a Client's idea is owned by the Agency and hidden from other Clients", async () => {
    const { engagements, ideas, access } = services();
    const proposed = await run(engagements.propose(alpha, { clientOrganizationId: "org-acme" }));
    const accepted = await run(engagements.accept(acme, proposed.id));
    await run(engagements.share(alpha, { engagementId: accepted.id, projectId: "site" }));

    const submitted = await run(
      ideas.submit(acme, {
        engagementId: accepted.id,
        title: "Nightly digest",
        description: "Send a digest after close of business.",
      }),
    );
    expect(submitted.idea.organizationId).toBe("org-alpha");
    expect(submitted.idea.status).toBe("active");

    const listed = await run(ideas.list(alpha, accepted.id));
    expect(listed.data.map((idea) => idea.title)).toEqual(["Nightly digest"]);
    expect(await run(ideas.list(acme, accepted.id))).toEqual(listed);

    await expect(run(ideas.list(stranger, accepted.id))).rejects.toThrow("Engagement not found");
    await expect(
      run(ideas.submit(alpha, { engagementId: accepted.id, title: "Nope" })),
    ).rejects.toThrow("Engagement not found");

    const otherEngagement = await sharedEngagement(other, "internal");
    await expect(run(ideas.list(other, accepted.id))).rejects.toThrow("Engagement not found");
    expect(await run(ideas.list(other, otherEngagement.id))).toEqual({ data: [] });

    expect(await access.projectAccess(alpha, "site")).toBe("owned");
    expect(await access.projectAccess(acme, "site")).toBe("client");
    expect(await access.projectAccess(acme, "internal")).toBeNull();
  });

  test("either side generates a report scoped to its Engagement", async () => {
    const { portal } = services();
    const acmeEngagement = await sharedEngagement(acme, "site");
    await sharedEngagement(other, "internal");

    const fromClient = await run(
      portal.generateReport(acme, { engagementId: acmeEngagement.id, note: "For the board" }),
    );
    expect(fromClient.overview.projectCount).toBe(1);
    expect(fromClient.notes).toBe("For the board");
    expect(fromClient.clientBreakdown.map((row) => row.clientName)).toEqual(["Acme Corp"]);

    const fromAgency = await run(
      portal.generateReport(alpha, { engagementId: acmeEngagement.id, note: "Internal copy" }),
    );
    expect(fromAgency.overview.projectCount).toBe(1);
    expect(fromAgency.notes).toBe("Internal copy");
    expect(fromAgency.clientBreakdown).toHaveLength(1);
  });

  test("the Agency manages agent links and either party can list them", async () => {
    const { links } = services();
    const engagement = await sharedEngagement(acme, "site");

    const created = await run(
      links.create(alpha, {
        engagementId: engagement.id,
        label: "Brief",
        url: "https://agents.example/brief",
      }),
    );
    expect(created.link.url).toBe("https://agents.example/brief");

    const listed = await run(links.list(acme, engagement.id));
    expect(listed.data.map((link) => link.label)).toEqual(["Brief"]);
    expect(await run(links.list(alpha, engagement.id))).toEqual(listed);

    await expect(
      run(
        links.create(acme, { engagementId: engagement.id, label: "Nope", url: "https://x.test" }),
      ),
    ).rejects.toThrow("Engagement not found");
    await expect(run(links.list(stranger, engagement.id))).rejects.toThrow("Engagement not found");
    await expect(
      run(links.create(alpha, { engagementId: engagement.id, label: "Bad", url: "not a url" })),
    ).rejects.toThrow("http(s)");
  });
});
