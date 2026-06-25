const NEARN_BASE = "https://nearn.io";

export function nearnListingUrl(slug: string): string {
  return `${NEARN_BASE}/listing/${slug}`;
}

export function nearnSponsorUrl(sponsorSlug: string): string {
  return `${NEARN_BASE}/${sponsorSlug}/`;
}
