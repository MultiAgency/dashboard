import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { billings, budgets, engagementProjects, engagements, proposals } from "../../src/db/schema";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createProjectDirectory, type ProjectsClient } from "../../src/services/project-directory";
import { createReportsService } from "../../src/services/reports";
import { inMemoryOrganizations } from "../fakes/organizations";
import { agencyScope } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const AGENCY = "agency-r.sputnik-dao.near";
const scope = agencyScope(AGENCY, { organizationId: "agency-org" });
const organizations = inMemoryOrganizations({
  organizations: [
    { id: "client-a", name: "Client A" },
    { id: "client-b", name: "Client B" },
  ],
}).directory;

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
    organizationId: AGENCY,
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

describe("reports.generate", () => {
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

  function buildReports(plugins: PluginsClient) {
    const directory = createProjectDirectory(() => plugins.projects() as ProjectsClient);
    return createReportsService(db as never, directory, plugins, organizations);
  }

  async function insertClient(id: string) {
    await db.insert(engagements).values({
      id,
      agencyOrganizationId: "agency-org",
      clientOrganizationId: id,
      status: "active",
      proposedBy: "admin",
    });
  }

  async function linkProject(engagementId: string, projectId: string) {
    await db.insert(engagementProjects).values({ engagementId, projectId });
  }

  async function insertBudget(
    id: string,
    projectId: string,
    tokenId: string,
    amount: string,
    engagementId?: string,
  ) {
    await db.insert(budgets).values({
      id,
      projectId,
      tokenId,
      amount,
      engagementId,
      actorAccountId: "admin.near",
      createdAt: new Date(),
    });
  }

  // Seeds a billing whose proposal is pre-cached as "Approved" in the local `proposals`
  // table, so enrichWithChainStatus resolves it from the DB with no RPC/network call.
  async function insertApprovedBilling(opts: {
    id: string;
    projectId: string;
    nearAccount: string;
    tokenId: string;
    amount: string;
    proposalId: number;
  }) {
    await db.insert(proposals).values({
      daoAccountId: AGENCY,
      proposalId: opts.proposalId,
      proposer: opts.nearAccount,
      description: "test proposal",
      status: "Approved",
      kindType: "Transfer",
      submissionTime: "0",
    });
    await db.insert(billings).values({
      id: opts.id,
      projectId: opts.projectId,
      nearAccount: opts.nearAccount,
      tokenId: opts.tokenId,
      amount: opts.amount,
      proposalId: String(opts.proposalId),
      createdAt: new Date(),
    });
  }

  test("generate — startDate after endDate → BAD_REQUEST", async () => {
    const reports = buildReports(createFakePlugins([]));

    await expect(
      Effect.runPromise(
        reports.generate(scope, { startDate: "2024-02-01", endDate: "2024-01-01" }),
      ),
    ).rejects.toThrow(/startDate must be on or before endDate/);
  });

  test("generate (client route) — unknown engagement → NOT_FOUND", async () => {
    const reports = buildReports(createFakePlugins([]));

    await expect(
      Effect.runPromise(reports.generate(scope, { engagementId: "does-not-exist" })),
    ).rejects.toThrow(/Engagement not found/);
  });

  test("generate — no date range → covers full history, period reflects that", async () => {
    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-1", slug: "project-one" })]),
    );

    const result = await Effect.runPromise(reports.generate(scope, {}));

    expect(result.overview.period).toBe("all time");
    expect(result.overview.projectCount).toBe(1);
  });

  test("generate — startDate only / endDate only → period string format correct", async () => {
    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-1", slug: "project-one" })]),
    );

    const startOnly = await Effect.runPromise(reports.generate(scope, { startDate: "2024-01-01" }));
    expect(startOnly.overview.period).toBe("from 2024-01-01");

    const endOnly = await Effect.runPromise(reports.generate(scope, { endDate: "2024-01-31" }));
    expect(endOnly.overview.period).toBe("through 2024-01-31");
  });

  test("generate — per-token summation across multiple billings is correct", async () => {
    await insertClient("client-a");
    await linkProject("client-a", "project-a");
    await insertBudget("budget-near", "project-a", "near", "1000");
    await insertBudget("budget-usdc", "project-a", "usdc", "500");
    await insertApprovedBilling({
      id: "billing-1",
      projectId: "project-a",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "100",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-2",
      projectId: "project-a",
      nearAccount: "bob.near",
      tokenId: "near",
      amount: "50",
      proposalId: 2,
    });
    await insertApprovedBilling({
      id: "billing-3",
      projectId: "project-a",
      nearAccount: "alice.near",
      tokenId: "usdc",
      amount: "20",
      proposalId: 3,
    });

    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-a", slug: "project-a-slug" })]),
    );

    const result = await Effect.runPromise(reports.generate(scope, {}));

    expect(result.overview.budgetByToken).toEqual([
      { tokenId: "near", amount: "1000" },
      { tokenId: "usdc", amount: "500" },
    ]);
    expect(result.overview.billedByToken).toEqual([
      { tokenId: "near", amount: "150" },
      { tokenId: "usdc", amount: "20" },
    ]);
  });

  test("generate (admin route) — agency-wide, includes clientBreakdown across multiple clients", async () => {
    await insertClient("client-a");
    await linkProject("client-a", "project-a");
    await insertBudget("budget-a", "project-a", "near", "1000", "client-a");
    await insertApprovedBilling({
      id: "billing-a",
      projectId: "project-a",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "200",
      proposalId: 1,
    });

    await insertClient("client-b");
    await linkProject("client-b", "project-b");
    await insertBudget("budget-b", "project-b", "near", "2000", "client-b");
    await insertApprovedBilling({
      id: "billing-b",
      projectId: "project-b",
      nearAccount: "bob.near",
      tokenId: "near",
      amount: "300",
      proposalId: 2,
    });

    const reports = buildReports(
      createFakePlugins([
        makeProject({ id: "project-a", slug: "project-a-slug", title: "Project A" }),
        makeProject({ id: "project-b", slug: "project-b-slug", title: "Project B" }),
      ]),
    );

    const result = await Effect.runPromise(reports.generate(scope, {}));

    expect(result.clientBreakdown).toHaveLength(2);
    expect(result.clientBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientName: "Client A",
          projectTitle: "Project A",
          budgetByToken: [{ tokenId: "near", amount: "1000" }],
          spentByToken: [{ tokenId: "near", amount: "200" }],
        }),
        expect.objectContaining({
          clientName: "Client B",
          projectTitle: "Project B",
          budgetByToken: [{ tokenId: "near", amount: "2000" }],
          spentByToken: [{ tokenId: "near", amount: "300" }],
        }),
      ]),
    );
  });

  test("generate (client route) — scoped to one client, doesn't leak another client's data into the response", async () => {
    await insertClient("client-a");
    await insertClient("client-b");
    await linkProject("client-a", "project-shared");
    await linkProject("client-b", "project-shared");
    await insertBudget("budget-shared", "project-shared", "near", "1000");
    await insertApprovedBilling({
      id: "billing-a",
      projectId: "project-shared",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "100",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-b",
      projectId: "project-shared",
      nearAccount: "bob.near",
      tokenId: "near",
      amount: "999",
      proposalId: 2,
    });

    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-shared", slug: "project-shared-slug" })]),
    );

    const result = await Effect.runPromise(reports.generate(scope, { engagementId: "client-a" }));

    expect(result.overview.billedByToken).toEqual([{ tokenId: "near", amount: "1099" }]);
    expect(result.contributorStats.map((c) => c.nearAccount).sort()).toEqual([
      "alice.near",
      "bob.near",
    ]);
    expect(result.clientBreakdown).toEqual([
      expect.objectContaining({
        clientName: "Client A",
        spentByToken: [{ tokenId: "near", amount: "1099" }],
      }),
    ]);
  });

  test("generate — contributorStats billing counts match seeded data", async () => {
    await insertClient("client-a");
    await linkProject("client-a", "project-a");
    await insertApprovedBilling({
      id: "billing-carol-1",
      projectId: "project-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "10",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-carol-2",
      projectId: "project-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "20",
      proposalId: 2,
    });
    await insertApprovedBilling({
      id: "billing-carol-3",
      projectId: "project-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "30",
      proposalId: 3,
    });
    await insertApprovedBilling({
      id: "billing-dave-1",
      projectId: "project-a",
      nearAccount: "dave.near",
      tokenId: "near",
      amount: "5",
      proposalId: 4,
    });
    await insertApprovedBilling({
      id: "billing-dave-2",
      projectId: "project-a",
      nearAccount: "dave.near",
      tokenId: "near",
      amount: "5",
      proposalId: 5,
    });

    const reports = buildReports(
      createFakePlugins(
        [makeProject({ id: "project-a", slug: "project-a-slug" })],
        [{ nearAccount: "carol.near", name: "Carol Builder" }],
      ),
    );

    const result = await Effect.runPromise(reports.generate(scope, {}));

    expect(result.contributorStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nearAccount: "carol.near",
          name: "Carol Builder",
          billingCount: 3,
          billedByToken: [{ tokenId: "near", amount: "60" }],
        }),
        expect.objectContaining({
          nearAccount: "dave.near",
          name: "dave.near",
          billingCount: 2,
          billedByToken: [{ tokenId: "near", amount: "10" }],
        }),
      ]),
    );
  });
});
