import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { fetchWithTimeout } from "./fetch";
import { getDaoAccountId } from "../lib/org";
import { defaultNearnAccountId } from "./settings-admin";

const NEARN_BASE_URL = "https://nearn.io";
const LISTING_TTL_MS = 60_000;
const SPONSOR_LISTINGS_TTL_MS = 60_000;
const SUBMISSIONS_TTL_MS = 60_000;

export class NearnNotFoundError extends Error {
  constructor(readonly slug: string) {
    super(`NEARN listing not found: ${slug}`);
    this.name = "NearnNotFoundError";
  }
}

// NEARN mainnet-only; testnet orgAccounts → unavailable.
export function isNearnAvailable(orgAccountId: string): boolean {
  return !orgAccountId.endsWith(".testnet");
}

// `compensationType` values per NEARN's Prisma model — defensively typed as nullable string at
// the wire boundary so an unknown future value doesn't crash parsing; consumers narrow as needed.
export type NearnCompensationType = "fixed" | "range" | "variable";
export type NearnSubmissionLimit = "single" | "multiple";

export interface NearnListing {
  slug: string;
  title: string | null;
  description: string | null;
  type: string | null;
  status: string | null;
  token: string | null;
  rewardAmount: number | null;
  // Sponsorship-aware: variable comp + ask range + recipient progress. Per the NEARN SKILL doc,
  // `BountyCounts` is a Prisma view joined to Bounties — `totalPaymentsMade` can lag the
  // `isWinnersAnnounced` boolean (observed: a project with announced winner had counts=0).
  compensationType: string | null;
  minRewardAsk: number | null;
  maxRewardAsk: number | null;
  submissionLimit: string | null;
  totalPaymentsMade: number | null;
  totalWinnersSelected: number | null;
  // Bounty position-tier prize distribution. Shape: `{"1": 500, "2": 100, ...}`. Stored stringified
  // to match the rest of the table's JSON-ish columns; consumers parse on display.
  rewards: string | null;
  maxBonusSpots: number | null;
  // UX-rich enrichment. usdValue stored as decimal string for parity with rewardAmount handling.
  // skills is a JSON-as-text array (parse on display) like rewards.
  usdValue: string | null;
  skills: string | null;
  region: string | null;
  applicationType: string | null;
  multipleSubmissionRule: string | null;
  timeToComplete: string | null;
  requirements: string | null;
  sequentialId: number | null;
  nearnPublishedAt: string | null;
  isFeatured: boolean | null;
  isPrivate: boolean | null;
  // Hackathon nested data (sparse — null for non-hackathon listings).
  isHackathonPrize: boolean | null;
  hackathonSlug: string | null;
  hackathonName: string | null;
  hackathonStartDate: string | null;
  hackathonAnnounceDate: string | null;
  deadline: string | null;
  isPublished: boolean | null;
  isArchived: boolean | null;
  isWinnersAnnounced: boolean | null;
  sponsor: {
    name: string | null;
    slug: string | null;
    logo: string | null;
    isVerified: boolean | null;
    // entityName/isCaution are returned by the details endpoint; url/twitter live only on
    // the sponsor-listings endpoint and are not part of this interface.
    entityName: string | null;
    isCaution: boolean | null;
  } | null;
}

// Mirrors GET /api/listings/submissions/<slug>/ response. Anonymous read; NEARN exposes
// submitter identity (incl. linked NEAR account via `user.publicKey`) and lifecycle state.
// Heavy fields omitted: Milestones, eligibilityAnswers, tweet, ogImage, otherInfo, like.
export interface NearnSubmission {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string | null;
    username: string | null;
    publicKey: string | null;
    photo: string | null;
  };
  isWinner: boolean | null;
  winnerPosition: number | null;
  status: string | null;
  label: string | null;
  ask: number | null;
  token: string | null;
  rewardInUSD: number | null;
  link: string | null;
  createdAt: string | null;
}

// Mirrors the POST /api/listings/sponsor/ response item exactly. Details-only fields
// (rewards/maxBonusSpots/usdValue/region/applicationType/multipleSubmissionRule/timeToComplete/etc.)
// require a follow-up details fetch.
export interface NearnSponsorBounty {
  slug: string;
  sequentialId: number | null;
  title: string | null;
  type: string | null;
  status: string | null;
  token: string | null;
  rewardAmount: number | null;
  compensationType: string | null;
  minRewardAsk: number | null;
  maxRewardAsk: number | null;
  totalPaymentsMade: number | null;
  totalWinnersSelected: number | null;
  deadline: string | null;
  isPublished: boolean | null;
  isFeatured: boolean | null;
  isPrivate: boolean | null;
  isWinnersAnnounced: boolean | null;
}

const listingCache = new Map<string, { listing: NearnListing; expiresAt: number }>();
const sponsorListingsCache = new Map<
  string,
  { bounties: NearnSponsorBounty[]; expiresAt: number }
>();
const submissionsCache = new Map<string, { submissions: NearnSubmission[]; expiresAt: number }>();

export async function getNearnListing(slug: string): Promise<NearnListing> {
  const cached = listingCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.listing;

  const response = await fetchWithTimeout(
    `${NEARN_BASE_URL}/api/listings/details/${encodeURIComponent(slug)}/`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (response.status === 404) {
    throw new NearnNotFoundError(slug);
  }
  if (!response.ok) {
    throw new Error(`NEARN listing fetch failed: ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const sponsorRaw = (raw.sponsor as Record<string, unknown> | undefined) ?? null;
  const countsRaw = (raw.BountyCounts as Record<string, unknown> | undefined) ?? null;
  const listing: NearnListing = {
    slug: (raw.slug as string) ?? slug,
    title: (raw.title as string) ?? null,
    description: (raw.description as string) ?? null,
    type: (raw.type as string) ?? null,
    status: (raw.status as string) ?? null,
    token: (raw.token as string) ?? null,
    rewardAmount: typeof raw.rewardAmount === "number" ? (raw.rewardAmount as number) : null,
    compensationType: (raw.compensationType as string) ?? null,
    minRewardAsk: typeof raw.minRewardAsk === "number" ? (raw.minRewardAsk as number) : null,
    maxRewardAsk: typeof raw.maxRewardAsk === "number" ? (raw.maxRewardAsk as number) : null,
    submissionLimit: (raw.submissionLimit as string) ?? null,
    totalPaymentsMade:
      countsRaw && typeof countsRaw.totalPaymentsMade === "number"
        ? (countsRaw.totalPaymentsMade as number)
        : null,
    totalWinnersSelected:
      countsRaw && typeof countsRaw.totalWinnersSelected === "number"
        ? (countsRaw.totalWinnersSelected as number)
        : null,
    rewards: raw.rewards && typeof raw.rewards === "object" ? JSON.stringify(raw.rewards) : null,
    maxBonusSpots: typeof raw.maxBonusSpots === "number" ? (raw.maxBonusSpots as number) : null,
    usdValue: typeof raw.usdValue === "number" ? String(raw.usdValue) : null,
    skills: raw.skills && typeof raw.skills === "object" ? JSON.stringify(raw.skills) : null,
    region: (raw.region as string) ?? null,
    applicationType: (raw.applicationType as string) ?? null,
    multipleSubmissionRule: (raw.multipleSubmissionRule as string) ?? null,
    timeToComplete: (raw.timeToComplete as string) ?? null,
    requirements: (raw.requirements as string) ?? null,
    sequentialId: typeof raw.sequentialId === "number" ? (raw.sequentialId as number) : null,
    nearnPublishedAt: (raw.publishedAt as string) ?? null,
    isFeatured: (raw.isFeatured as boolean) ?? null,
    isPrivate: (raw.isPrivate as boolean) ?? null,
    isHackathonPrize: (raw.hackathonprize as boolean) ?? null,
    hackathonSlug: null,
    hackathonName: null,
    hackathonStartDate: null,
    hackathonAnnounceDate: null,
    deadline: (raw.deadline as string) ?? null,
    isPublished: (raw.isPublished as boolean) ?? null,
    isArchived: (raw.isArchived as boolean) ?? null,
    isWinnersAnnounced: (raw.isWinnersAnnounced as boolean) ?? null,
    sponsor: sponsorRaw
      ? {
          name: (sponsorRaw.name as string) ?? null,
          slug: (sponsorRaw.slug as string) ?? null,
          logo: (sponsorRaw.logo as string) ?? null,
          isVerified: (sponsorRaw.isVerified as boolean) ?? null,
          entityName: (sponsorRaw.entityName as string) ?? null,
          isCaution: (sponsorRaw.isCaution as boolean) ?? null,
        }
      : null,
  };
  // Hackathon nested object is sparse — extract when present.
  const hackathonRaw = raw.Hackathon as Record<string, unknown> | undefined | null;
  if (hackathonRaw) {
    listing.hackathonSlug = (hackathonRaw.slug as string) ?? null;
    listing.hackathonName = (hackathonRaw.name as string) ?? null;
    listing.hackathonStartDate = (hackathonRaw.startDate as string) ?? null;
    listing.hackathonAnnounceDate = (hackathonRaw.announceDate as string) ?? null;
  }
  listingCache.set(slug, { listing, expiresAt: Date.now() + LISTING_TTL_MS });
  return listing;
}

export async function listNearnBountiesForSponsor(
  sponsorSlug: string,
): Promise<NearnSponsorBounty[]> {
  const cached = sponsorListingsCache.get(sponsorSlug);
  if (cached && cached.expiresAt > Date.now()) return cached.bounties;

  const response = await fetchWithTimeout(`${NEARN_BASE_URL}/api/listings/sponsor/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sponsor: sponsorSlug }),
  });
  if (!response.ok) {
    throw new Error(`NEARN sponsor listings fetch failed: ${response.status}`);
  }
  const raw = (await response.json()) as { bounties?: unknown };
  const arr: Array<Record<string, unknown>> = Array.isArray(raw?.bounties)
    ? (raw.bounties as Array<Record<string, unknown>>)
    : [];
  const bounties: NearnSponsorBounty[] = arr
    .filter(
      (b): b is Record<string, unknown> & { slug: string } =>
        typeof b.slug === "string" && b.slug.length > 0,
    )
    .map((b) => {
      const countsRaw = (b.BountyCounts as Record<string, unknown> | undefined) ?? null;
      return {
        slug: b.slug,
        sequentialId: typeof b.sequentialId === "number" ? (b.sequentialId as number) : null,
        title: (b.title as string) ?? null,
        type: (b.type as string) ?? null,
        status: (b.status as string) ?? null,
        token: (b.token as string) ?? null,
        rewardAmount: typeof b.rewardAmount === "number" ? (b.rewardAmount as number) : null,
        compensationType: (b.compensationType as string) ?? null,
        minRewardAsk: typeof b.minRewardAsk === "number" ? (b.minRewardAsk as number) : null,
        maxRewardAsk: typeof b.maxRewardAsk === "number" ? (b.maxRewardAsk as number) : null,
        totalPaymentsMade:
          countsRaw && typeof countsRaw.totalPaymentsMade === "number"
            ? (countsRaw.totalPaymentsMade as number)
            : null,
        totalWinnersSelected:
          countsRaw && typeof countsRaw.totalWinnersSelected === "number"
            ? (countsRaw.totalWinnersSelected as number)
            : null,
        deadline: (b.deadline as string) ?? null,
        isPublished: (b.isPublished as boolean) ?? null,
        isFeatured: (b.isFeatured as boolean) ?? null,
        isPrivate: (b.isPrivate as boolean) ?? null,
        isWinnersAnnounced: (b.isWinnersAnnounced as boolean) ?? null,
      };
    });
  sponsorListingsCache.set(sponsorSlug, {
    bounties,
    expiresAt: Date.now() + SPONSOR_LISTINGS_TTL_MS,
  });
  return bounties;
}

export async function getNearnListingSubmissions(slug: string): Promise<NearnSubmission[]> {
  const cached = submissionsCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.submissions;

  const response = await fetchWithTimeout(
    `${NEARN_BASE_URL}/api/listings/submissions/${encodeURIComponent(slug)}/`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (response.status === 404) {
    throw new NearnNotFoundError(slug);
  }
  if (!response.ok) {
    throw new Error(`NEARN submissions fetch failed: ${response.status}`);
  }
  const raw = (await response.json()) as { submission?: unknown };
  const arr: Array<Record<string, unknown>> = Array.isArray(raw?.submission)
    ? (raw.submission as Array<Record<string, unknown>>)
    : [];
  const submissions: NearnSubmission[] = arr
    .filter(
      (s): s is Record<string, unknown> & { id: string } =>
        typeof s.id === "string" && s.id.length > 0,
    )
    .map((s) => {
      const userRaw = (s.user as Record<string, unknown> | undefined) ?? {};
      return {
        id: s.id,
        userId: (s.userId as string) ?? "",
        user: {
          id: (userRaw.id as string) ?? "",
          name: (userRaw.name as string) ?? null,
          username: (userRaw.username as string) ?? null,
          publicKey: (userRaw.publicKey as string) ?? null,
          photo: (userRaw.photo as string) ?? null,
        },
        isWinner: (s.isWinner as boolean) ?? null,
        winnerPosition: typeof s.winnerPosition === "number" ? (s.winnerPosition as number) : null,
        status: (s.status as string) ?? null,
        label: (s.label as string) ?? null,
        ask: typeof s.ask === "number" ? (s.ask as number) : null,
        token: (s.token as string) ?? null,
        rewardInUSD: typeof s.rewardInUSD === "number" ? (s.rewardInUSD as number) : null,
        link: (s.link as string) ?? null,
        createdAt: (s.createdAt as string) ?? null,
      };
    });
  submissionsCache.set(slug, { submissions, expiresAt: Date.now() + SUBMISSIONS_TTL_MS });
  return submissions;
}

export function createNearnService() {
  return {
    getListing: (context: Record<string, unknown>, input: { slug: string }) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        if (!isNearnAvailable(orgAccountId)) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: "NEARN not available on this network",
            }),
          );
        }
        try {
          const listing = yield* Effect.promise(() => getNearnListing(input.slug));
          return { listing };
        } catch (err) {
          const message = (err as Error).message ?? "";
          if (message.includes("not found")) {
            return yield* Effect.fail(new ORPCError("NOT_FOUND", { message }));
          }
          throw err;
        }
      }),

    listSponsorBounties: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        if (!isNearnAvailable(orgAccountId)) {
          return { sponsorSlug: null, bounties: [] };
        }
        const sponsorSlug = yield* Effect.sync(() => defaultNearnAccountId());
        if (!sponsorSlug) {
          return { sponsorSlug: null, bounties: [] };
        }
        const bounties = yield* Effect.promise(() =>
          listNearnBountiesForSponsor(sponsorSlug),
        );
        return { sponsorSlug, bounties };
      }),

    listSubmissions: (context: Record<string, unknown>, input: { slug: string }) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        if (!isNearnAvailable(orgAccountId)) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", {
              message: "NEARN not available on this network",
            }),
          );
        }
        try {
          const submissions = yield* Effect.promise(() =>
            getNearnListingSubmissions(input.slug),
          );
          return { submissions };
        } catch (err) {
          const message = (err as Error).message ?? "";
          if (message.includes("not found")) {
            return yield* Effect.fail(new ORPCError("NOT_FOUND", { message }));
          }
          throw err;
        }
      }),
  };
}

export type NearnService = ReturnType<typeof createNearnService>;
