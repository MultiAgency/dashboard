import { describe, expect, it, test } from "vitest";
import type { Listing } from "../../src/db/schema";
import {
  isStale,
  listingRowToNearnPayload,
  mapNearnPayloadToListingFields,
} from "../../src/services/listings";
import type { NearnListing } from "../../src/services/nearn";

const FULL_PAYLOAD: NearnListing = {
  id: "0e6ba6ef-6e50-4149-89fe-f16f531e79cf",
  slug: "build-agency-portal",
  title: "Build agency portal",
  description: "Standard description",
  type: "Project",
  status: "OPEN",
  token: "NEAR",
  rewardAmount: 100,
  compensationType: "fixed",
  minRewardAsk: null,
  maxRewardAsk: null,
  submissionLimit: "single",
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
  isFeatured: null,
  isPrivate: null,
  isHackathonPrize: null,
  hackathonSlug: null,
  hackathonName: null,
  hackathonStartDate: null,
  hackathonAnnounceDate: null,
  deadline: "2026-12-31T00:00:00.000Z",
  isPublished: true,
  isArchived: false,
  isWinnersAnnounced: false,
  sponsor: {
    name: "MultiAgency",
    slug: "multiagency",
    logo: "https://nearn.io/logo.png",
    isVerified: true,
    entityName: null,
    isCaution: null,
  },
};

function nearnRow(overrides: Partial<Listing> = {}): Listing {
  const now = new Date("2026-05-01T00:00:00.000Z");
  return {
    id: "listing-1",
    projectId: "project-1",
    source: "nearn" as const,
    externalId: "build-agency-portal",
    externalUuid: "0e6ba6ef-6e50-4149-89fe-f16f531e79cf",
    title: "Build agency portal",
    description: "Standard description",
    type: "Project",
    status: "OPEN",
    token: "NEAR",
    rewardAmount: "100",
    compensationType: "fixed",
    minRewardAsk: null,
    maxRewardAsk: null,
    submissionLimit: "single",
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
    deadline: new Date("2026-12-31T00:00:00.000Z"),
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
    sponsorName: "MultiAgency",
    sponsorSlug: "multiagency",
    sponsorLogo: "https://nearn.io/logo.png",
    sponsorVerified: true,
    sponsorEntityName: null,
    sponsorIsCaution: null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("mapNearnPayloadToListingFields", () => {
  test("preserves all NEARN-side fields through to row fields", () => {
    const fields = mapNearnPayloadToListingFields(FULL_PAYLOAD);
    expect(fields).toEqual({
      title: "Build agency portal",
      description: "Standard description",
      type: "Project",
      status: "OPEN",
      token: "NEAR",
      rewardAmount: "100",
      compensationType: "fixed",
      minRewardAsk: null,
      maxRewardAsk: null,
      submissionLimit: "single",
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
      deadline: new Date("2026-12-31T00:00:00.000Z"),
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
      sponsorName: "MultiAgency",
      sponsorSlug: "multiagency",
      sponsorLogo: "https://nearn.io/logo.png",
      sponsorVerified: true,
      sponsorEntityName: null,
      sponsorIsCaution: null,
    });
  });

  test("rewardAmount: passes through normal numbers as decimal strings", () => {
    expect(
      mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: 0.5 }).rewardAmount,
    ).toBe("0.5");
    expect(mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: 0 }).rewardAmount).toBe(
      "0",
    );
    expect(
      mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: 1_000_000 }).rewardAmount,
    ).toBe("1000000");
  });

  test("rewardAmount: returns null for ≥1e21 (Number has lost integer precision)", () => {
    const big = mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: 1e21 });
    expect(big.rewardAmount).toBeNull();
  });

  test("rewardAmount: converts sub-1e-6 exponential to a non-exponential decimal string", () => {
    // String(1e-7) === "1e-7" (exponential) which BigInt can't parse downstream.
    // We convert via toFixed which preserves the float's bits but emits a parseable
    // decimal. The string may carry float noise (e.g. ...99999995) — that's fine,
    // it's a faithful representation of what the Number actually holds.
    const tiny = mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: 1e-7 });
    expect(tiny.rewardAmount).not.toMatch(/[eE]/);
    expect(tiny.rewardAmount?.startsWith("0.000000")).toBe(true);
  });

  test("rewardAmount: returns null for non-finite (NaN, Infinity)", () => {
    expect(
      mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: Number.NaN }).rewardAmount,
    ).toBeNull();
    expect(
      mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: Number.POSITIVE_INFINITY })
        .rewardAmount,
    ).toBeNull();
  });

  test("rewardAmount: null passes through", () => {
    expect(
      mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, rewardAmount: null }).rewardAmount,
    ).toBeNull();
  });

  test("deadline: null and ISO string handling", () => {
    expect(mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, deadline: null }).deadline).toBeNull();
    const d = mapNearnPayloadToListingFields(FULL_PAYLOAD).deadline;
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  test("sponsor: flattens nested object to six columns", () => {
    expect(mapNearnPayloadToListingFields({ ...FULL_PAYLOAD, sponsor: null })).toMatchObject({
      sponsorName: null,
      sponsorSlug: null,
      sponsorLogo: null,
      sponsorVerified: null,
      sponsorEntityName: null,
      sponsorIsCaution: null,
    });
  });
});

describe("listingRowToNearnPayload", () => {
  test("roundtrips NEARN-source rows back to NearnListing shape", () => {
    const row = nearnRow();
    const payload = listingRowToNearnPayload(row);
    expect(payload).toEqual({
      id: "0e6ba6ef-6e50-4149-89fe-f16f531e79cf",
      slug: "build-agency-portal",
      title: "Build agency portal",
      description: "Standard description",
      type: "Project",
      status: "OPEN",
      token: "NEAR",
      rewardAmount: 100,
      compensationType: "fixed",
      minRewardAsk: null,
      maxRewardAsk: null,
      submissionLimit: "single",
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
      isFeatured: null,
      isPrivate: null,
      isHackathonPrize: null,
      hackathonSlug: null,
      hackathonName: null,
      hackathonStartDate: null,
      hackathonAnnounceDate: null,
      deadline: "2026-12-31T00:00:00.000Z",
      isPublished: true,
      isArchived: false,
      isWinnersAnnounced: false,
      sponsor: {
        name: "MultiAgency",
        slug: "multiagency",
        logo: "https://nearn.io/logo.png",
        isVerified: true,
        entityName: null,
        isCaution: null,
      },
    });
  });

  test("returns null for internal-source rows", () => {
    const row = nearnRow({ source: "internal" });
    expect(listingRowToNearnPayload(row)).toBeNull();
  });

  test("returns null when externalId is missing", () => {
    const row = nearnRow({ externalId: null });
    expect(listingRowToNearnPayload(row)).toBeNull();
  });

  test("sponsor: null when both name and slug are null", () => {
    const row = nearnRow({ sponsorName: null, sponsorSlug: null });
    expect(listingRowToNearnPayload(row)?.sponsor).toBeNull();
  });

  test("rewardAmount: null passes through", () => {
    const row = nearnRow({ rewardAmount: null });
    expect(listingRowToNearnPayload(row)?.rewardAmount).toBeNull();
  });
});

describe("payload ↔ row roundtrip", () => {
  test("payload → fields → row → payload preserves all data (modulo deadline shape)", () => {
    const fields = mapNearnPayloadToListingFields(FULL_PAYLOAD);
    const row = nearnRow({ ...fields });
    const roundtripped = listingRowToNearnPayload(row);
    expect(roundtripped).toEqual({
      ...FULL_PAYLOAD,
      // deadline ISO string is preserved exactly because we use the same instant.
      deadline: FULL_PAYLOAD.deadline,
    });
  });
});

describe("isStale", () => {
  it("flags rows with no syncedAt as stale", () => {
    expect(isStale(nearnRow({ syncedAt: null }))).toBe(true);
  });

  it("flags rows synced more than 5 minutes ago as stale", () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
    expect(isStale(nearnRow({ syncedAt: sixMinutesAgo }))).toBe(true);
  });

  it("treats fresh rows (synced within 5 minutes) as not stale", () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    expect(isStale(nearnRow({ syncedAt: oneMinuteAgo }))).toBe(false);
  });
});
