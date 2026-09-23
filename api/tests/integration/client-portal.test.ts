import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  billings,
  budgets,
  clientProjects,
  clients,
  projectContributors,
} from "../../src/db/schema";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createBillingsService } from "../../src/services/billings";
import { createClientPortalService } from "../../src/services/client-portal";
import { createClientsService } from "../../src/services/clients";
import { createReportsService } from "../../src/services/reports";
import { applyAllMigrations } from "./_pg";

const AGENCY_A = "agency-a.sputnik-dao.near";
const AGENCY_B = "agency-b.sputnik-dao.near";
const NEAR_ACCOUNT = "client.near";

describe("client-portal — resolveClientScope (via clients.getByNearAndAgency)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  let clientsService: ReturnType<typeof createClientsService>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg);
    clientsService = createClientsService(db as never);
  });

  afterEach(async () => {
    await pg.close();
  });

  async function insertClient(id: string, agencyDaoAccountId: string, nearAccountId: string) {
    await db.insert(clients).values({
      id,
      orgId: agencyDaoAccountId,
      agencyDaoAccountId,
      name: "Test Client",
      nearAccountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  test("valid nearAccountId + agencyDaoAccountId resolves the right client", async () => {
    await insertClient("client-1", AGENCY_A, NEAR_ACCOUNT);

    const result = await Effect.runPromise(
      clientsService.getByNearAndAgency(NEAR_ACCOUNT, AGENCY_A),
    );

    expect(result).not.toBeNull();
    expect(result?.client.id).toBe("client-1");
    expect(result?.client.agencyDaoAccountId).toBe(AGENCY_A);
    expect(result?.projectIds).toEqual([]);
  });

  test("unknown NEAR account resolves to no scope", async () => {
    await insertClient("client-1", AGENCY_A, NEAR_ACCOUNT);

    const result = await Effect.runPromise(
      clientsService.getByNearAndAgency("stranger.near", AGENCY_A),
    );

    expect(result).toBeNull();
  });

  test("right NEAR account but wrong agencyDaoAccountId resolves to no scope (cross-agency leak check)", async () => {
    await insertClient("client-1", AGENCY_A, NEAR_ACCOUNT);

    const result = await Effect.runPromise(
      clientsService.getByNearAndAgency(NEAR_ACCOUNT, AGENCY_B),
    );

    expect(result).toBeNull();
  });
});

// Agency id ends in .testnet so `isNearnAvailable` short-circuits the NEARN listing
// lookup in agency.listProjects — keeps these tests free of network calls.
const AGENCY_C = "agency-c.sputnik-dao.testnet";

type FakeUpstreamProject = {
  id: string;
  ownerId: string;
  organizationId: string;
  slug: string;
  title: string;
  description: string | null;
  repository: string | null;
  kind: string;
  status: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
};

function makeProject(overrides: Partial<FakeUpstreamProject> & { id: string; slug: string }) {
  return {
    ownerId: "owner.near",
    organizationId: AGENCY_C,
    title: overrides.title ?? overrides.slug,
    description: null,
    repository: null,
    kind: "project",
    status: "active",
    visibility: "public",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as FakeUpstreamProject;
}

function createFakePlugins(
  projects: FakeUpstreamProject[],
  builders: Array<{ nearAccount: string; name: string | null }> = [],
): PluginsClient {
  return {
    projects: () =>
      ({
        listProjects: async ({ organizationId }: { organizationId: string }) => ({
          data: projects.filter((p) => p.organizationId === organizationId),
          meta: { nextCursor: null },
        }),
        getProject: async ({ id }: { id: string }) => {
          const project = projects.find((p) => p.id === id);
          if (!project) {
            throw new ORPCError("NOT_FOUND", { message: "Project not found" });
          }
          return { data: project };
        },
      }) as never,
    builders: () =>
      ({
        listBuilders: async () => ({ data: builders }),
      }) as never,
    auth: () => ({}) as never,
  } as PluginsClient;
}

describe("client-portal — dashboardSummary / listProjects / getProject", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;
  let clientsService: ReturnType<typeof createClientsService>;

  beforeEach(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg);
    clientsService = createClientsService(db as never);
  });

  afterEach(async () => {
    await pg.close();
  });

  function buildPortal(plugins: PluginsClient) {
    const agency = createAgencyService(db as never, plugins);
    const billingsService = createBillingsService(db as never, agency);
    const reports = createReportsService(db as never, agency, plugins);
    return createClientPortalService(clientsService, agency, billingsService, reports);
  }

  async function insertClient(id: string) {
    await db.insert(clients).values({
      id,
      orgId: AGENCY_C,
      agencyDaoAccountId: AGENCY_C,
      name: "Test Client",
      nearAccountId: NEAR_ACCOUNT,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function linkProject(clientId: string, projectId: string) {
    await db.insert(clientProjects).values({ clientId, projectId, createdAt: new Date() });
  }

  test("dashboard.summary — correct projectCount and remainingByToken for a client with projects + billings", async () => {
    await insertClient("client-4");
    await linkProject("client-4", "project-1");
    await db.insert(budgets).values({
      id: "budget-1",
      projectId: "project-1",
      tokenId: "near",
      amount: "1000",
      actorAccountId: "admin.near",
      createdAt: new Date(),
    });

    const plugins = createFakePlugins([makeProject({ id: "project-1", slug: "project-one" })]);
    const portal = buildPortal(plugins);

    const summary = await Effect.runPromise(portal.dashboardSummary(NEAR_ACCOUNT, AGENCY_C, {}));

    expect(summary.projectCount).toBe(1);
    expect(summary.remainingByToken).toEqual([{ tokenId: "near", amount: "1000" }]);
  });

  test("projects.list — only returns projects belonging to that client, not siblings under the same agency", async () => {
    await insertClient("client-5");
    await linkProject("client-5", "project-a");

    const plugins = createFakePlugins([
      makeProject({ id: "project-a", slug: "project-a-slug" }),
      makeProject({ id: "project-b", slug: "project-b-slug" }),
    ]);
    const portal = buildPortal(plugins);

    const result = await Effect.runPromise(portal.listProjects(NEAR_ACCOUNT, AGENCY_C, {}));

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe("project-a");
  });

  test("projects.get — returns project + contributors for a valid slug", async () => {
    await insertClient("client-6");
    await linkProject("client-6", "project-a");
    await db.insert(projectContributors).values({
      projectId: "project-a",
      nearAccount: "builder.near",
      role: "engineer",
      createdAt: new Date(),
    });

    const plugins = createFakePlugins(
      [makeProject({ id: "project-a", slug: "project-a-slug" })],
      [{ nearAccount: "builder.near", name: "Builder Name" }],
    );
    const portal = buildPortal(plugins);

    const result = await Effect.runPromise(
      portal.getProject(NEAR_ACCOUNT, AGENCY_C, "project-a-slug", {}),
    );

    expect(result.project.slug).toBe("project-a-slug");
    expect(result.contributors).toEqual([
      { nearAccount: "builder.near", name: "Builder Name", role: "engineer" },
    ]);
  });

  test("projects.get — NOT_FOUND for a slug belonging to a different client", async () => {
    await insertClient("client-7");
    await linkProject("client-7", "project-a");

    const plugins = createFakePlugins([
      makeProject({ id: "project-a", slug: "project-a-slug" }),
      makeProject({ id: "project-c", slug: "project-c-slug" }),
    ]);
    const portal = buildPortal(plugins);

    await expect(
      Effect.runPromise(portal.getProject(NEAR_ACCOUNT, AGENCY_C, "project-c-slug", {})),
    ).rejects.toThrow(/Project not found/);
  });

  test("projects.getBudget — budget numbers match seeded billings/budgets", async () => {
    await insertClient("client-8");
    await linkProject("client-8", "project-a");
    await db.insert(budgets).values({
      id: "budget-8",
      projectId: "project-a",
      tokenId: "near",
      amount: "1000",
      actorAccountId: "admin.near",
      createdAt: new Date(),
    });
    // Non-numeric proposalId short-circuits enrichWithChainStatus's DAO lookup and
    // defaults to "InProgress" — keeps this test free of any network/RPC call.
    await db.insert(billings).values({
      id: "billing-8",
      projectId: "project-a",
      clientId: "client-8",
      nearAccount: "builder.near",
      tokenId: "near",
      amount: "200",
      proposalId: "not-a-number",
      createdAt: new Date(),
    });

    const plugins = createFakePlugins([makeProject({ id: "project-a", slug: "project-a-slug" })]);
    const portal = buildPortal(plugins);

    const result = await Effect.runPromise(
      portal.getBudget(NEAR_ACCOUNT, AGENCY_C, "project-a", {}),
    );

    expect(result.budgets).toEqual([
      {
        tokenId: "near",
        budget: "1000",
        allocated: "0",
        committed: "200",
        paid: "0",
        remaining: "800",
      },
    ]);
  });

  test("billings.list — scoped to the client, with pagination cursor working", async () => {
    await insertClient("client-9");
    await linkProject("client-9", "project-a");
    // A second client under the same agency, sharing the project — proves billings
    // scoping is by billings.clientId, not just project membership.
    await db.insert(clients).values({
      id: "client-other",
      orgId: AGENCY_C,
      agencyDaoAccountId: AGENCY_C,
      name: "Other Client",
      nearAccountId: "other-client.near",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const base = Date.parse("2024-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await db.insert(billings).values({
        id: `billing-9-${i}`,
        projectId: "project-a",
        clientId: "client-9",
        nearAccount: "builder.near",
        tokenId: "near",
        amount: "100",
        proposalId: `prop-9-${i}`,
        createdAt: new Date(base + i * 1000),
      });
    }
    // Belongs to a different client under the same agency/project set — must never
    // leak into client-9's page.
    await db.insert(billings).values({
      id: "billing-other",
      projectId: "project-a",
      clientId: "client-other",
      nearAccount: "other.near",
      tokenId: "near",
      amount: "999",
      proposalId: "prop-other",
      createdAt: new Date(base + 5000),
    });

    const plugins = createFakePlugins([makeProject({ id: "project-a", slug: "project-a-slug" })]);
    const portal = buildPortal(plugins);

    const page1 = await Effect.runPromise(
      portal.listBillings(NEAR_ACCOUNT, AGENCY_C, { limit: 2 }, {}),
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.data.every((b) => b.clientId === "client-9")).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await Effect.runPromise(
      portal.listBillings(NEAR_ACCOUNT, AGENCY_C, { limit: 2, cursor: page1.nextCursor! }, {}),
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]?.id).toBe("billing-9-0");
    expect(page2.nextCursor).toBeNull();
  });
});
