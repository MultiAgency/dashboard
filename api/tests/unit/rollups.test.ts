import { describe, expect, it } from "vitest";
import type { Listing } from "../../src/db/schema";
import {
  assembleAgencyRollups,
  computeAvailable,
  type ProposalStatus,
  resolveActiveListing,
  rollupForToken,
  tokenIdsForRollup,
} from "../../src/services/rollups";

// Minimal listing factory — fields we don't use can stay defaulted.
const mkListing = (overrides: Partial<Listing>): Listing => ({
  id: "l-test",
  projectId: "p-test",
  source: "nearn",
  externalId: "slug-test",
  externalUuid: null,
  title: null,
  description: null,
  type: null,
  status: null,
  token: "NEAR",
  rewardAmount: "100",
  compensationType: null,
  minRewardAsk: null,
  maxRewardAsk: null,
  submissionLimit: null,
  totalPaymentsMade: null,
  totalWinnersSelected: null,
  rewards: null,
  maxBonusSpots: null,
  usdValue: null,
  skills: null,
  region: null,
  applicationType: null,
  multipleSubmissionRule: null,
  timeToComplete: null,
  requirements: null,
  sequentialId: null,
  nearnPublishedAt: null,
  deadline: null,
  isPublished: true,
  isArchived: false,
  isFeatured: null,
  isPrivate: null,
  isWinnersAnnounced: false,
  isHackathonPrize: null,
  hackathonSlug: null,
  hackathonName: null,
  hackathonStartDate: null,
  hackathonAnnounceDate: null,
  sponsorName: null,
  sponsorSlug: null,
  sponsorLogo: null,
  sponsorVerified: null,
  sponsorEntityName: null,
  sponsorIsCaution: null,
  syncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("resolveActiveListing", () => {
  it("returns null when both inputs are null", () => {
    expect(resolveActiveListing(null, null)).toBeNull();
  });

  it("prefers NEARN-source when both are present", () => {
    const nearn = mkListing({ source: "nearn", rewardAmount: "100", token: "NEAR" });
    const internal = mkListing({ source: "internal", rewardAmount: "50", token: "NEAR" });
    const r = resolveActiveListing(nearn, internal);
    expect(r?.baseAmount).toBe(100n * 10n ** 24n);
  });

  it("falls back to internal when no NEARN", () => {
    const internal = mkListing({ source: "internal", rewardAmount: "50", token: "NEAR" });
    const r = resolveActiveListing(null, internal);
    expect(r?.baseAmount).toBe(50n * 10n ** 24n);
  });

  it("returns null when listing is unpublished", () => {
    const l = mkListing({ isPublished: false });
    expect(resolveActiveListing(l, null)).toBeNull();
  });

  it("returns null when listing is archived", () => {
    const l = mkListing({ isArchived: true });
    expect(resolveActiveListing(l, null)).toBeNull();
  });

  it("returns null when token symbol is unknown", () => {
    const l = mkListing({ token: "DOGECOIN" });
    expect(resolveActiveListing(l, null)).toBeNull();
  });

  it("returns null when rewardAmount is missing", () => {
    const l = mkListing({ rewardAmount: null });
    expect(resolveActiveListing(l, null)).toBeNull();
  });

  it("preserves isWinnersAnnounced flag", () => {
    const l = mkListing({ isWinnersAnnounced: true });
    const r = resolveActiveListing(l, null);
    expect(r?.isWinnersAnnounced).toBe(true);
  });

  it("treats null isWinnersAnnounced as false", () => {
    const l = mkListing({ isWinnersAnnounced: null });
    const r = resolveActiveListing(l, null);
    expect(r?.isWinnersAnnounced).toBe(false);
  });

  // Pin SPEC inv 82 interpretation A: a NEARN row's mere existence (active or not)
  // excludes the internal-source listing. To switch a project to internal, the
  // operator must detach the NEARN row first.
  it("archived NEARN row dominates an active internal listing (no fallback)", () => {
    const nearnArchived = mkListing({ source: "nearn", isArchived: true });
    const internalActive = mkListing({
      source: "internal",
      isPublished: true,
      isArchived: false,
      rewardAmount: "50",
      token: "NEAR",
    });
    expect(resolveActiveListing(nearnArchived, internalActive)).toBeNull();
  });

  it("unpublished NEARN row dominates an active internal listing (no fallback)", () => {
    const nearnDraft = mkListing({ source: "nearn", isPublished: false });
    const internalActive = mkListing({
      source: "internal",
      isPublished: true,
      isArchived: false,
      rewardAmount: "50",
      token: "NEAR",
    });
    expect(resolveActiveListing(nearnDraft, internalActive)).toBeNull();
  });
});

describe("rollupForToken — math invariants", () => {
  // Invariant the entire rollup model depends on:
  // allocated + committed + paid + remaining = budget (per token, per project).
  const expectInvariant = (r: ReturnType<typeof rollupForToken>) => {
    expect(r.allocated + r.committed + r.paid + r.remaining).toBe(r.budget);
  };

  const bill = (amount: string, status: ProposalStatus) => ({ amount, status });

  it("empty inputs: all zero", () => {
    const r = rollupForToken({ tokenId: "near", budgetAmounts: [], billings: [], listing: null });
    expect(r).toEqual({
      tokenId: "near",
      budget: 0n,
      allocated: 0n,
      committed: 0n,
      paid: 0n,
      remaining: 0n,
    });
    expectInvariant(r);
  });

  it("budget only: budget=sum, remaining=budget", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [100n, 50n],
      billings: [],
      listing: null,
    });
    expect(r.budget).toBe(150n);
    expect(r.remaining).toBe(150n);
    expectInvariant(r);
  });

  it("listing active no winners: amount goes to allocated", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [200n],
      billings: [],
      listing: { tokenId: "near", baseAmount: 75n, isWinnersAnnounced: false },
    });
    expect(r.allocated).toBe(75n);
    expect(r.committed).toBe(0n);
    expect(r.remaining).toBe(125n);
    expectInvariant(r);
  });

  it("listing active winners announced, no billings: amount goes to committed", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [200n],
      billings: [],
      listing: { tokenId: "near", baseAmount: 75n, isWinnersAnnounced: true },
    });
    expect(r.allocated).toBe(0n);
    expect(r.committed).toBe(75n);
    expect(r.remaining).toBe(125n);
    expectInvariant(r);
  });

  it("double-counting guard: any non-failed billing suppresses listing's committed", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [200n],
      billings: [bill("60", "InProgress")],
      listing: { tokenId: "near", baseAmount: 75n, isWinnersAnnounced: true },
    });
    // Listing's 75n is suppressed — only billing's 60n counts as committed.
    expect(r.committed).toBe(60n);
    expect(r.allocated).toBe(0n);
    expect(r.paid).toBe(0n);
    expect(r.remaining).toBe(140n);
    expectInvariant(r);
  });

  it("approved billing also suppresses listing's committed (any non-failed)", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [200n],
      billings: [bill("60", "Approved")],
      listing: { tokenId: "near", baseAmount: 75n, isWinnersAnnounced: true },
    });
    expect(r.committed).toBe(0n);
    expect(r.paid).toBe(60n);
    expectInvariant(r);
  });

  it("listing tokenId mismatch: listing ignored entirely", () => {
    const r = rollupForToken({
      tokenId: "usdc",
      budgetAmounts: [200n],
      billings: [],
      listing: { tokenId: "near", baseAmount: 75n, isWinnersAnnounced: false },
    });
    expect(r.allocated).toBe(0n);
    expect(r.committed).toBe(0n);
    expect(r.remaining).toBe(200n);
    expectInvariant(r);
  });

  it("terminal-fail billings excluded from all columns", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [200n],
      billings: [
        bill("30", "Rejected"),
        bill("40", "Removed"),
        bill("50", "Expired"),
        bill("60", "Moved"),
        bill("70", "Failed"),
      ],
      listing: null,
    });
    expect(r.committed).toBe(0n);
    expect(r.paid).toBe(0n);
    expect(r.remaining).toBe(200n);
    expectInvariant(r);
  });

  it("mixed billings: InProgress→committed, Approved→paid, terminal-fail→none", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [500n],
      billings: [
        bill("40", "InProgress"),
        bill("60", "InProgress"),
        bill("80", "Approved"),
        bill("100", "Rejected"),
      ],
      listing: null,
    });
    expect(r.committed).toBe(100n);
    expect(r.paid).toBe(80n);
    expect(r.remaining).toBe(320n);
    expectInvariant(r);
  });

  it("over-committed: remaining goes negative, invariant still holds", () => {
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [100n],
      billings: [bill("75", "Approved"), bill("50", "InProgress")],
      listing: null,
    });
    expect(r.budget).toBe(100n);
    expect(r.paid).toBe(75n);
    expect(r.committed).toBe(50n);
    expect(r.remaining).toBe(-25n);
    expectInvariant(r);
  });

  it("listing pre-winners + billing for same token: listing→allocated, billing→committed independently", () => {
    // Pre-winners listing isn't suppressed by billings; it represents an unselected offer.
    const r = rollupForToken({
      tokenId: "near",
      budgetAmounts: [500n],
      billings: [bill("100", "InProgress")],
      listing: { tokenId: "near", baseAmount: 200n, isWinnersAnnounced: false },
    });
    expect(r.allocated).toBe(200n);
    expect(r.committed).toBe(100n);
    expect(r.paid).toBe(0n);
    expect(r.remaining).toBe(200n);
    expectInvariant(r);
  });
});

describe("computeAvailable", () => {
  it("returns balance when nothing budgeted or paid", () => {
    expect(computeAvailable(1000n, 0n, 0n)).toBe(1000n);
  });

  it("subtracts outstanding obligations (budgeted - paid)", () => {
    expect(computeAvailable(1000n, 300n, 100n)).toBe(800n); // 1000 - (300 - 100)
  });

  it("equals balance when fully paid", () => {
    expect(computeAvailable(1000n, 500n, 500n)).toBe(1000n);
  });

  it("can go negative when obligations exceed balance", () => {
    expect(computeAvailable(100n, 500n, 100n)).toBe(-300n);
  });
});

describe("tokenIdsForRollup — distinct sorted union", () => {
  it("returns [] for empty inputs", () => {
    expect(
      tokenIdsForRollup({
        projectIds: [],
        budgetRows: [],
        billingRows: [],
        nearnListings: new Map(),
        internalListings: new Map(),
      }),
    ).toEqual([]);
  });

  it("unions budget, billing, and listing token ids", () => {
    const ids = tokenIdsForRollup({
      projectIds: ["p1"],
      budgetRows: [{ projectId: "p1", tokenId: "usdc", amount: "1" }],
      billingRows: [{ projectId: "p1", tokenId: "near", amount: "1", status: "Approved" }],
      nearnListings: new Map([
        ["p1", mkListing({ projectId: "p1", token: "NEAR", rewardAmount: "5" })],
      ]),
      internalListings: new Map(),
    });
    // NEAR listing maps to tokenId "near" via getTokenMetadataBySymbol
    expect(ids).toEqual(["near", "usdc"]);
  });

  it("dedupes across inputs", () => {
    const ids = tokenIdsForRollup({
      projectIds: ["p1", "p2"],
      budgetRows: [
        { projectId: "p1", tokenId: "near", amount: "1" },
        { projectId: "p2", tokenId: "near", amount: "2" },
      ],
      billingRows: [{ projectId: "p1", tokenId: "near", amount: "1", status: "Approved" }],
      nearnListings: new Map(),
      internalListings: new Map(),
    });
    expect(ids).toEqual(["near"]);
  });
});

describe("assembleAgencyRollups — orchestration across projects and tokens", () => {
  it("returns [] when no projects", () => {
    expect(
      assembleAgencyRollups({
        projectIds: [],
        budgetRows: [],
        billingRows: [],
        nearnListings: new Map(),
        internalListings: new Map(),
        balances: {},
      }),
    ).toEqual([]);
  });

  it("sums per-token budgets across multiple projects", () => {
    const rollups = assembleAgencyRollups({
      projectIds: ["p1", "p2"],
      budgetRows: [
        { projectId: "p1", tokenId: "near", amount: "1000" },
        { projectId: "p2", tokenId: "near", amount: "500" },
      ],
      billingRows: [],
      nearnListings: new Map(),
      internalListings: new Map(),
      balances: { near: "2000" },
    });
    expect(rollups).toHaveLength(1);
    expect(rollups[0]?.tokenId).toBe("near");
    expect(rollups[0]?.budgeted).toBe("1500");
    expect(rollups[0]?.balance).toBe("2000");
    expect(rollups[0]?.remaining).toBe("1500"); // 1500 - 0 - 0 - 0
    expect(rollups[0]?.available).toBe("500"); // 2000 - (1500 - 0)
  });

  it("computes available = balance - (budgeted - paid)", () => {
    const rollups = assembleAgencyRollups({
      projectIds: ["p1"],
      budgetRows: [{ projectId: "p1", tokenId: "near", amount: "1000" }],
      billingRows: [{ projectId: "p1", tokenId: "near", amount: "300", status: "Approved" }],
      nearnListings: new Map(),
      internalListings: new Map(),
      balances: { near: "2000" },
    });
    // paid = 300, budgeted = 1000, available = 2000 - (1000 - 300) = 1300
    expect(rollups[0]?.budgeted).toBe("1000");
    expect(rollups[0]?.paid).toBe("300");
    expect(rollups[0]?.available).toBe("1300");
  });

  it("produces separate rollup entries for each token, sorted alphabetically", () => {
    const rollups = assembleAgencyRollups({
      projectIds: ["p1"],
      budgetRows: [
        { projectId: "p1", tokenId: "usdc", amount: "100" },
        { projectId: "p1", tokenId: "near", amount: "200" },
      ],
      billingRows: [],
      nearnListings: new Map(),
      internalListings: new Map(),
      balances: { near: "300", usdc: "150" },
    });
    expect(rollups.map((r) => r.tokenId)).toEqual(["near", "usdc"]);
    expect(rollups[0]?.budgeted).toBe("200");
    expect(rollups[1]?.budgeted).toBe("100");
  });

  it("defaults balance to 0 when a token isn't in the balances map", () => {
    const rollups = assembleAgencyRollups({
      projectIds: ["p1"],
      budgetRows: [{ projectId: "p1", tokenId: "usdc", amount: "100" }],
      billingRows: [],
      nearnListings: new Map(),
      internalListings: new Map(),
      balances: {}, // no entry for usdc
    });
    expect(rollups[0]?.balance).toBe("0");
    expect(rollups[0]?.available).toBe("-100"); // 0 - (100 - 0)
  });

  it("rolls listing into allocated until winners announced", () => {
    const listing = mkListing({
      projectId: "p1",
      token: "NEAR",
      rewardAmount: "5",
      isWinnersAnnounced: false,
    });
    const rollups = assembleAgencyRollups({
      projectIds: ["p1"],
      budgetRows: [{ projectId: "p1", tokenId: "near", amount: "10000000000000000000000000" }], // 10 NEAR
      billingRows: [],
      nearnListings: new Map([["p1", listing]]),
      internalListings: new Map(),
      balances: { near: "0" },
    });
    expect(rollups[0]?.allocated).toBe("5000000000000000000000000"); // 5 NEAR base units
    expect(rollups[0]?.committed).toBe("0");
  });

  it("listing flips to committed when winners announced and no billings exist", () => {
    const listing = mkListing({
      projectId: "p1",
      token: "NEAR",
      rewardAmount: "5",
      isWinnersAnnounced: true,
    });
    const rollups = assembleAgencyRollups({
      projectIds: ["p1"],
      budgetRows: [{ projectId: "p1", tokenId: "near", amount: "10000000000000000000000000" }],
      billingRows: [],
      nearnListings: new Map([["p1", listing]]),
      internalListings: new Map(),
      balances: { near: "0" },
    });
    expect(rollups[0]?.allocated).toBe("0");
    expect(rollups[0]?.committed).toBe("5000000000000000000000000");
  });

  // Pins the contract that treasury.getRollups uses to defend against listing-cascade
  // divergence: archived projects are excluded at the rollup-call boundary (their data
  // never enters projectIds), so their budgets/billings/listings contribute zero.
  it("excludes archived projects when caller filters projectIds (defense in depth for cascade)", () => {
    const archivedListing = mkListing({ projectId: "p-archived", rewardAmount: "5" });
    const activeListing = mkListing({ projectId: "p-active", rewardAmount: "3" });

    const inputs = {
      budgetRows: [
        { projectId: "p-active", tokenId: "near", amount: "1000" },
        { projectId: "p-archived", tokenId: "near", amount: "999999" },
      ],
      billingRows: [
        {
          projectId: "p-archived",
          tokenId: "near",
          amount: "500",
          status: "Approved" as ProposalStatus,
        },
      ],
      nearnListings: new Map([
        ["p-active", activeListing],
        ["p-archived", archivedListing],
      ]),
      internalListings: new Map<string, Listing>(),
      balances: { near: "10000" },
    };

    // Caller (treasury.getRollups) filters out archived; only p-active reaches the rollup.
    const activeOnly = assembleAgencyRollups({ projectIds: ["p-active"], ...inputs });
    // Sanity: without the filter, p-archived's data would dominate.
    const unfiltered = assembleAgencyRollups({
      projectIds: ["p-active", "p-archived"],
      ...inputs,
    });

    expect(activeOnly[0]?.budgeted).toBe("1000");
    expect(activeOnly[0]?.paid).toBe("0");
    expect(unfiltered[0]?.budgeted).toBe("1000999");
    expect(unfiltered[0]?.paid).toBe("500");
  });
});
