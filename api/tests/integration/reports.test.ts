import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { billings, budgets, clientProjects, clients, proposals } from "../../src/db/schema";
import type { PluginsClient } from "../../src/lib/plugins-types.gen";
import { createAgencyService } from "../../src/services/agency";
import { createReportsService } from "../../src/services/reports";
import { applyAllMigrations } from "./_pg";

const AGENCY = "agency-r.sputnik-dao.near";

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
    const agency = createAgencyService(db as never, plugins);
    return createReportsService(db as never, agency, plugins);
  }

  async function insertClient(id: string, name: string) {
    await db.insert(clients).values({
      id,
      orgId: AGENCY,
      agencyDaoAccountId: AGENCY,
      name,
      nearAccountId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function linkProject(clientId: string, projectId: string) {
    await db.insert(clientProjects).values({ clientId, projectId, createdAt: new Date() });
  }

  async function insertBudget(id: string, projectId: string, tokenId: string, amount: string) {
    await db.insert(budgets).values({
      id,
      projectId,
      tokenId,
      amount,
      actorAccountId: "admin.near",
      createdAt: new Date(),
    });
  }

  // Seeds a billing whose proposal is pre-cached as "Approved" in the local `proposals`
  // table, so enrichWithChainStatus resolves it from the DB with no RPC/network call.
  async function insertApprovedBilling(opts: {
    id: string;
    projectId: string;
    clientId?: string;
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
      clientId: opts.clientId ?? null,
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
        reports.generate({}, AGENCY, { startDate: "2024-02-01", endDate: "2024-01-01" }),
      ),
    ).rejects.toThrow(/startDate must be on or before endDate/);
  });

  test("generate (client route) — unknown client → NOT_FOUND", async () => {
    const reports = buildReports(createFakePlugins([]));

    await expect(
      Effect.runPromise(reports.generate({}, AGENCY, { clientId: "does-not-exist" })),
    ).rejects.toThrow(/Client not found/);
  });

  test("generate — no date range → covers full history, period reflects that", async () => {
    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-1", slug: "project-one" })]),
    );

    const result = await Effect.runPromise(reports.generate({}, AGENCY, {}));

    expect(result.overview.period).toBe("all time");
    expect(result.overview.projectCount).toBe(1);
  });

  test("generate — startDate only / endDate only → period string format correct", async () => {
    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-1", slug: "project-one" })]),
    );

    const startOnly = await Effect.runPromise(
      reports.generate({}, AGENCY, { startDate: "2024-01-01" }),
    );
    expect(startOnly.overview.period).toBe("from 2024-01-01");

    const endOnly = await Effect.runPromise(
      reports.generate({}, AGENCY, { endDate: "2024-01-31" }),
    );
    expect(endOnly.overview.period).toBe("through 2024-01-31");
  });

  test("generate — per-token summation across multiple billings is correct", async () => {
    await insertClient("client-a", "Client A");
    await linkProject("client-a", "project-a");
    await insertBudget("budget-near", "project-a", "near", "1000");
    await insertBudget("budget-usdc", "project-a", "usdc", "500");
    await insertApprovedBilling({
      id: "billing-1",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "100",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-2",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "bob.near",
      tokenId: "near",
      amount: "50",
      proposalId: 2,
    });
    await insertApprovedBilling({
      id: "billing-3",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "alice.near",
      tokenId: "usdc",
      amount: "20",
      proposalId: 3,
    });

    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-a", slug: "project-a-slug" })]),
    );

    const result = await Effect.runPromise(reports.generate({}, AGENCY, {}));

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
    await insertClient("client-a", "Client A");
    await linkProject("client-a", "project-a");
    await insertBudget("budget-a", "project-a", "near", "1000");
    await insertApprovedBilling({
      id: "billing-a",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "200",
      proposalId: 1,
    });

    await insertClient("client-b", "Client B");
    await linkProject("client-b", "project-b");
    await insertBudget("budget-b", "project-b", "near", "2000");
    await insertApprovedBilling({
      id: "billing-b",
      projectId: "project-b",
      clientId: "client-b",
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

    const result = await Effect.runPromise(reports.generate({}, AGENCY, {}));

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
    // Both clients are linked to the SAME project, and each has its own billing row on
    // it — this exercises the billings.clientId filter directly, not just project scoping.
    await insertClient("client-a", "Client A");
    await insertClient("client-b", "Client B");
    await linkProject("client-a", "project-shared");
    await linkProject("client-b", "project-shared");
    await insertBudget("budget-shared", "project-shared", "near", "1000");
    await insertApprovedBilling({
      id: "billing-a",
      projectId: "project-shared",
      clientId: "client-a",
      nearAccount: "alice.near",
      tokenId: "near",
      amount: "100",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-b",
      projectId: "project-shared",
      clientId: "client-b",
      nearAccount: "bob.near",
      tokenId: "near",
      amount: "999",
      proposalId: 2,
    });

    const reports = buildReports(
      createFakePlugins([makeProject({ id: "project-shared", slug: "project-shared-slug" })]),
    );

    const result = await Effect.runPromise(reports.generate({}, AGENCY, { clientId: "client-a" }));

    expect(result.overview.billedByToken).toEqual([{ tokenId: "near", amount: "100" }]);
    expect(result.contributorStats.map((c) => c.nearAccount)).toEqual(["alice.near"]);
    expect(result.clientBreakdown).toEqual([
      expect.objectContaining({
        clientName: "Client A",
        spentByToken: [{ tokenId: "near", amount: "100" }],
      }),
    ]);
  });

  test("generate — contributorStats billing counts match seeded data", async () => {
    await insertClient("client-a", "Client A");
    await linkProject("client-a", "project-a");
    await insertApprovedBilling({
      id: "billing-carol-1",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "10",
      proposalId: 1,
    });
    await insertApprovedBilling({
      id: "billing-carol-2",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "20",
      proposalId: 2,
    });
    await insertApprovedBilling({
      id: "billing-carol-3",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "carol.near",
      tokenId: "near",
      amount: "30",
      proposalId: 3,
    });
    await insertApprovedBilling({
      id: "billing-dave-1",
      projectId: "project-a",
      clientId: "client-a",
      nearAccount: "dave.near",
      tokenId: "near",
      amount: "5",
      proposalId: 4,
    });
    await insertApprovedBilling({
      id: "billing-dave-2",
      projectId: "project-a",
      clientId: "client-a",
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

    const result = await Effect.runPromise(reports.generate({}, AGENCY, {}));

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
