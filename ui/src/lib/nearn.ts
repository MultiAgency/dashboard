const NEARN_BASE = "https://nearn.io";

/**
 * Public listing URL: `https://nearn.io/{sponsorSlug}/{listingUuid}/`
 * Pass the NEARN listing UUID (from the API payload), not the slug.
 */
export function nearnListingUrl(listingUuid: string, sponsorSlug: string): string {
  const key = listingUuid.trim().replace(/^\/+|\/+$/g, "");
  const sponsor = sponsorSlug.trim().replace(/^\/+|\/+$/g, "");
  return `${NEARN_BASE}/${sponsor}/${key}/`;
}

export function nearnSponsorUrl(sponsorSlug: string): string {
  return `${NEARN_BASE}/${sponsorSlug.trim().replace(/^\/+|\/+$/g, "")}/`;
}

/** Public listing href when sponsor + listing UUID are known. */
export function nearnListingHref(
  listing: {
    id?: string | null;
    sponsor?: { slug?: string | null } | null;
  },
  fallbackSponsor?: string | null,
): string | null {
  const sponsor = listing.sponsor?.slug?.trim() || fallbackSponsor?.trim() || null;
  const id = listing.id?.trim() || null;
  if (!sponsor || !id) return null;
  return nearnListingUrl(id, sponsor);
}

/** NEARN descriptions are TipTap HTML — strip to a short plain-text card preview. */
export function nearnDescriptionPreview(
  html: string | null | undefined,
  maxLength = 180,
): string | null {
  if (!html) return null;
  const trimmed = html.trim();
  if (!trimmed) return null;

  // TipTap blocks abut with no whitespace; insert breaks before stripping tags.
  const withBreaks = trimmed
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|ul|ol)\s*>/gi, "\n");

  let text: string;
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(withBreaks, "text/html");
    text = doc.body.textContent ?? "";
  } else {
    text = withBreaks.replace(/<[^>]+>/g, " ");
  }

  const plain = text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;

  if (plain.length <= maxLength) return plain;

  const slice = plain.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const clipped = (lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd();
  return `${clipped}…`;
}

type NearnRewardShape = {
  compensationType?: string | null;
  rewardAmount?: number | null;
  minRewardAsk?: number | null;
  maxRewardAsk?: number | null;
  token?: string | null;
};

export function formatNearnReward(n: NearnRewardShape): string {
  if (n.compensationType === "variable") {
    if (n.rewardAmount != null && n.token) return `variable · up to ${n.rewardAmount} ${n.token}`;
    return "variable";
  }
  if (
    n.compensationType === "range" &&
    n.minRewardAsk != null &&
    n.maxRewardAsk != null &&
    n.token
  ) {
    return `${n.minRewardAsk}–${n.maxRewardAsk} ${n.token}`;
  }
  if (n.rewardAmount != null && n.token) return `${n.rewardAmount} ${n.token}`;
  return "—";
}
