import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import * as schema from "../../src/db/schema";
import { billings, budgets, listings, proposals } from "../../src/db/schema";
import type { ProjectRollup } from "../../src/services/ledger";
import { createProjectLedgers } from "../../src/services/ledger";
import { createInternalListing, createListingsService } from "../../src/services/listings";
import { createProjectDirectory } from "../../src/services/project-directory";
import type { DaoProposalStatus } from "../../src/services/sputnik";
import { agencyScope, inMemoryProjects } from "../fakes/projects";
import { applyAllMigrations } from "./_pg";

const PROJECT_A = "00000000-0000-0000-0000-00000000000a";
const PROJECT_B = "00000000-0000-0000-0000-00000000000b";
const USDT = "usdt.tether-token.near";
const NEAR_REWARD = (near: bigint) => (near * 10n ** 24n).toString();

function expectBalanced(rollup: ProjectRollup | undefined) {
  if (!rollup) throw new Error("missing rollup");
  const spent = BigInt(rollup.allocated) + BigInt(rollup.committed) + BigInt(rollup.paid);
  expect(spent + BigInt(rollup.remaining)).toBe(BigInt(rollup.budget));
}

let daoCounter = 0;
function uniqueDao(): string {
  daoCounter += 1;
  return `ledger-test-${daoCounter}.sputnik-dao.near`;
}

describe("project ledger", () => {
  let pg: PGlite;
  let db: Database;
  let DAO: string;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    pg = new PGlite("memory://");
    await applyAllMigrations(pg);
    db = drizzle(pg, { schema }) as unknown as Database;
    globalThis.fetch = (async () => {
      throw new Error("network disabled in ledger tests");
    }) as typeof fetch;
  });

  beforeEach(async () => {
    DAO = uniqueDao();
    await pg.query("TRUNCATE budgets, billings, listings, proposals");
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await pg.close();
  });

  function ledgers() {
    const directory = createProjectDirectory(() => inMemoryProjects([]).client);
    return createProjectLedgers(db, createListingsService(db, directory));
  }

  async function addBudget(projectId: string, tokenId: string, amount: string) {
    await db.insert(budgets).values({
      id: crypto.randomUUID(),
      projectId,
      tokenId,
      amount,
      note: null,
      actorAccountId: "admin.near",
    });
  }

  let proposalCounter = 0;

  async function addBilling(
    projectId: string,
    tokenId: string,
    amount: string,
    decided?: Exclude<DaoProposalStatus, "InProgress">,
  ) {
    proposalCounter += 1;
    if (decided) {
      await db.insert(proposals).values({
        daoAccountId: DAO,
        proposalId: proposalCounter,
        proposer: "admin.near",
        description: "payout",
        status: decided,
        kindType: "Transfer",
        transferTokenId: tokenId,
        transferReceiverId: "dev.near",
        transferAmount: amount,
        submissionTime: "1700000000000000000",
      });
    }
    await db.insert(billings).values({
      id: crypto.randomUUID(),
      projectId,
      nearAccount: "dev.near",
      tokenId,
      amount,
      proposalId: String(proposalCounter),
    });
  }

  test("sums budget entries per token, including deallocations", async () => {
    await addBudget(PROJECT_A, "near", "1000");
    await addBudget(PROJECT_A, "near", "-300");
    await addBudget(PROJECT_A, "usdc.near", "50");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A]);

    expect(ledger.rollupsFor(PROJECT_A)).toEqual([
      {
        tokenId: "near",
        budget: "700",
        allocated: "0",
        committed: "0",
        paid: "0",
        remaining: "700",
      },
      {
        tokenId: "usdc.near",
        budget: "50",
        allocated: "0",
        committed: "0",
        paid: "0",
        remaining: "50",
      },
    ]);
  });

  test("approved billings are paid, undecided ones committed, rejected ones ignored", async () => {
    await addBudget(PROJECT_A, "near", "1000");
    await addBilling(PROJECT_A, "near", "200", "Approved");
    await addBilling(PROJECT_A, "near", "150");
    await addBilling(PROJECT_A, "near", "400", "Rejected");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A]);

    expect(ledger.rollupsFor(PROJECT_A)).toEqual([
      {
        tokenId: "near",
        budget: "1000",
        allocated: "0",
        committed: "150",
        paid: "200",
        remaining: "650",
      },
    ]);
  });

  async function addNearnListing(
    projectId: string,
    fields: Partial<typeof listings.$inferInsert> = {},
  ) {
    await db.insert(listings).values({
      id: crypto.randomUUID(),
      projectId,
      source: "nearn",
      externalId: `slug-${projectId}`,
      token: "NEAR",
      rewardAmount: "100",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      syncedAt: new Date(),
      ...fields,
    });
  }

  async function addListing(projectId: string, lifecycle: "published" | "winners_announced") {
    await createInternalListing(
      projectId,
      {
        title: "Build it",
        type: "Bounty",
        token: "USDT",
        rewardAmount: "25",
        isPublished: true,
        isWinnersAnnounced: lifecycle === "winners_announced",
        isArchived: false,
      },
      db,
    );
  }

  test("a published listing allocates its reward in base units", async () => {
    await addBudget(PROJECT_A, USDT, "100000000");
    await addListing(PROJECT_A, "published");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A]);

    expect(ledger.rollupsFor(PROJECT_A)).toEqual([
      {
        tokenId: USDT,
        budget: "100000000",
        allocated: "25000000",
        committed: "0",
        paid: "0",
        remaining: "75000000",
      },
    ]);
  });

  test("after winners are announced the reward is committed until a billing exists", async () => {
    await addBudget(PROJECT_A, USDT, "100000000");
    await addListing(PROJECT_A, "winners_announced");

    const before = await ledgers().load(agencyScope(DAO), [PROJECT_A]);
    expect(before.rollupsFor(PROJECT_A)[0]).toMatchObject({
      allocated: "0",
      committed: "25000000",
      remaining: "75000000",
    });

    await addBilling(PROJECT_A, USDT, "25000000", "Approved");

    const after = await ledgers().load(agencyScope(DAO), [PROJECT_A]);
    expect(after.rollupsFor(PROJECT_A)[0]).toMatchObject({
      committed: "0",
      paid: "25000000",
      remaining: "75000000",
    });
  });

  test("rejected, removed, expired, moved and failed billings count for nothing", async () => {
    await addBudget(PROJECT_A, "near", "200");
    for (const status of ["Rejected", "Removed", "Expired", "Moved", "Failed"] as const) {
      await addBilling(PROJECT_A, "near", "30", status);
    }

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({ committed: "0", paid: "0", remaining: "200" });
    expectBalanced(rollup);
  });

  test("spending past the budget leaves a negative remaining", async () => {
    await addBudget(PROJECT_A, "near", "100");
    await addBilling(PROJECT_A, "near", "75", "Approved");
    await addBilling(PROJECT_A, "near", "50");

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({ paid: "75", committed: "50", remaining: "-25" });
    expectBalanced(rollup);
  });

  test("the NEARN listing wins over the internal one", async () => {
    await addBudget(PROJECT_A, "near", NEAR_REWARD(500n));
    await addNearnListing(PROJECT_A, { rewardAmount: "100" });
    await createInternalListing(
      PROJECT_A,
      { title: "Internal", type: "Bounty", token: "NEAR", rewardAmount: "50", isPublished: true },
      db,
    );

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({ tokenId: "near", allocated: NEAR_REWARD(100n) });
    expectBalanced(rollup);
  });

  test("an unpublished or archived NEARN listing still hides the internal one", async () => {
    await addBudget(PROJECT_A, "near", NEAR_REWARD(500n));
    await addBudget(PROJECT_B, "near", NEAR_REWARD(500n));
    await addNearnListing(PROJECT_A, { isPublished: false });
    await addNearnListing(PROJECT_B, { isArchived: true });
    for (const projectId of [PROJECT_A, PROJECT_B]) {
      await createInternalListing(
        projectId,
        { title: "Internal", type: "Bounty", token: "NEAR", rewardAmount: "50", isPublished: true },
        db,
      );
    }

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A, PROJECT_B]);

    expect(ledger.rollupsFor(PROJECT_A)[0]).toMatchObject({ allocated: "0", committed: "0" });
    expect(ledger.rollupsFor(PROJECT_B)[0]).toMatchObject({ allocated: "0", committed: "0" });
  });

  test("listings without a known token or reward are left out", async () => {
    await addBudget(PROJECT_A, "near", "100");
    await addBudget(PROJECT_B, "near", "100");
    await addNearnListing(PROJECT_A, { token: "DOGECOIN" });
    await addNearnListing(PROJECT_B, { rewardAmount: null });

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A, PROJECT_B]);

    expect(ledger.rollupsFor(PROJECT_A)).toEqual([
      expect.objectContaining({ tokenId: "near", allocated: "0" }),
    ]);
    expect(ledger.rollupsFor(PROJECT_B)).toEqual([
      expect.objectContaining({ tokenId: "near", allocated: "0" }),
    ]);
  });

  test("after winners are announced an undecided billing replaces the listing reward", async () => {
    await addBudget(PROJECT_A, "near", NEAR_REWARD(200n));
    await addNearnListing(PROJECT_A, { rewardAmount: "75", isWinnersAnnounced: true });
    await addBilling(PROJECT_A, "near", NEAR_REWARD(60n));

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({
      allocated: "0",
      committed: NEAR_REWARD(60n),
      remaining: NEAR_REWARD(140n),
    });
    expectBalanced(rollup);
  });

  test("a rejected billing does not replace an announced listing reward", async () => {
    await addBudget(PROJECT_A, "near", NEAR_REWARD(200n));
    await addNearnListing(PROJECT_A, { rewardAmount: "75", isWinnersAnnounced: true });
    await addBilling(PROJECT_A, "near", NEAR_REWARD(75n), "Rejected");

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({ committed: NEAR_REWARD(75n), paid: "0" });
    expectBalanced(rollup);
  });

  test("before winners are announced the listing reward and billings add up", async () => {
    await addBudget(PROJECT_A, "near", NEAR_REWARD(500n));
    await addNearnListing(PROJECT_A, { rewardAmount: "200" });
    await addBilling(PROJECT_A, "near", NEAR_REWARD(100n));

    const [rollup] = (await ledgers().load(agencyScope(DAO), [PROJECT_A])).rollupsFor(PROJECT_A);

    expect(rollup).toMatchObject({
      allocated: NEAR_REWARD(200n),
      committed: NEAR_REWARD(100n),
      remaining: NEAR_REWARD(200n),
    });
    expectBalanced(rollup);
  });

  test("agency rollups total every project and fold treasury balance into available", async () => {
    await addBudget(PROJECT_A, "near", "1000");
    await addBilling(PROJECT_A, "near", "200", "Approved");
    await addBudget(PROJECT_B, "near", "500");
    await addBilling(PROJECT_B, "near", "100");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A, PROJECT_B]);

    expect(ledger.tokenIds).toEqual(["near"]);
    expect(ledger.agencyRollups({ near: "5000" })).toEqual([
      {
        tokenId: "near",
        balance: "5000",
        budgeted: "1500",
        allocated: "0",
        committed: "100",
        paid: "200",
        remaining: "1200",
        available: "3700",
      },
    ]);
  });

  test("agency rollups can report tokens the ledger has never seen", async () => {
    await addBudget(PROJECT_A, "near", "1000");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A]);

    expect(ledger.agencyRollups({ near: "4000", [USDT]: "9" }, [USDT, "near"])).toEqual([
      {
        tokenId: USDT,
        balance: "9",
        budgeted: "0",
        allocated: "0",
        committed: "0",
        paid: "0",
        remaining: "0",
        available: "9",
      },
      {
        tokenId: "near",
        balance: "4000",
        budgeted: "1000",
        allocated: "0",
        committed: "0",
        paid: "0",
        remaining: "1000",
        available: "3000",
      },
    ]);
  });

  test("projects outside the requested set are ignored", async () => {
    await addBudget(PROJECT_A, "near", "1000");
    await addBudget(PROJECT_B, "near", "999");

    const ledger = await ledgers().load(agencyScope(DAO), [PROJECT_A]);

    expect(ledger.rollupsFor(PROJECT_B)).toEqual([]);
    expect(ledger.agencyRollups({})[0]).toMatchObject({ budgeted: "1000", available: "-1000" });
  });
});
