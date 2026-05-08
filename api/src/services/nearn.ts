import { fetchWithTimeout } from "./fetch";

const NEARN_BASE_URL = "https://nearn.io";
const LISTING_TTL_MS = 60_000;
const SPONSOR_LISTINGS_TTL_MS = 60_000;

export interface NearnListing {
  slug: string;
  title: string | null;
  description: string | null;
  type: string | null;
  status: string | null;
  token: string | null;
  rewardAmount: number | null;
  deadline: string | null;
  isPublished: boolean | null;
  isArchived: boolean | null;
  isWinnersAnnounced: boolean | null;
  sponsor: {
    name: string | null;
    slug: string | null;
    logo: string | null;
    isVerified: boolean | null;
  } | null;
}

export interface NearnSponsorBounty {
  slug: string;
  title: string | null;
  type: string | null;
  status: string | null;
  token: string | null;
  rewardAmount: number | null;
  deadline: string | null;
  isPublished: boolean | null;
  isFeatured: boolean | null;
  isWinnersAnnounced: boolean | null;
}

const listingCache = new Map<string, { listing: NearnListing; expiresAt: number }>();
const sponsorListingsCache = new Map<
  string,
  { bounties: NearnSponsorBounty[]; expiresAt: number }
>();

export async function getNearnListing(slug: string): Promise<NearnListing> {
  const cached = listingCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.listing;

  const response = await fetchWithTimeout(
    `${NEARN_BASE_URL}/api/listings/details/${encodeURIComponent(slug)}/`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (response.status === 404) {
    throw new Error(`NEARN listing not found: ${slug}`);
  }
  if (!response.ok) {
    throw new Error(`NEARN listing fetch failed: ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const sponsorRaw = (raw.sponsor as Record<string, unknown> | undefined) ?? null;
  const listing: NearnListing = {
    slug: (raw.slug as string) ?? slug,
    title: (raw.title as string) ?? null,
    description: (raw.description as string) ?? null,
    type: (raw.type as string) ?? null,
    status: (raw.status as string) ?? null,
    token: (raw.token as string) ?? null,
    rewardAmount: typeof raw.rewardAmount === "number" ? (raw.rewardAmount as number) : null,
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
        }
      : null,
  };
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
    .map((b) => ({
      slug: b.slug,
      title: (b.title as string) ?? null,
      type: (b.type as string) ?? null,
      status: (b.status as string) ?? null,
      token: (b.token as string) ?? null,
      rewardAmount: typeof b.rewardAmount === "number" ? (b.rewardAmount as number) : null,
      deadline: (b.deadline as string) ?? null,
      isPublished: (b.isPublished as boolean) ?? null,
      isFeatured: (b.isFeatured as boolean) ?? null,
      isWinnersAnnounced: (b.isWinnersAnnounced as boolean) ?? null,
    }));
  sponsorListingsCache.set(sponsorSlug, {
    bounties,
    expiresAt: Date.now() + SPONSOR_LISTINGS_TTL_MS,
  });
  return bounties;
}
