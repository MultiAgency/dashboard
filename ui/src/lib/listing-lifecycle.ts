export const internalListingLifecycleValues = [
  "draft",
  "published",
  "winners_announced",
  "archived",
] as const;

export type InternalListingLifecycle = (typeof internalListingLifecycleValues)[number];

export const LIFECYCLE_TRANSITIONS: Record<InternalListingLifecycle, InternalListingLifecycle[]> = {
  draft: ["published", "archived"],
  published: ["winners_announced", "archived", "draft"],
  winners_announced: ["archived", "published"],
  archived: ["draft"],
};

export function lifecycleToFlags(lifecycle: InternalListingLifecycle): {
  isPublished: boolean;
  isWinnersAnnounced: boolean;
  isArchived: boolean;
} {
  switch (lifecycle) {
    case "archived":
      return { isPublished: true, isWinnersAnnounced: true, isArchived: true };
    case "winners_announced":
      return { isPublished: true, isWinnersAnnounced: true, isArchived: false };
    case "published":
      return { isPublished: true, isWinnersAnnounced: false, isArchived: false };
    default:
      return { isPublished: false, isWinnersAnnounced: false, isArchived: false };
  }
}

export function flagsToLifecycle(flags: {
  isPublished?: boolean | null;
  isWinnersAnnounced?: boolean | null;
  isArchived?: boolean | null;
}): InternalListingLifecycle {
  if (flags.isArchived) return "archived";
  if (flags.isWinnersAnnounced) return "winners_announced";
  if (flags.isPublished) return "published";
  return "draft";
}

export function lifecycleLabel(lifecycle: InternalListingLifecycle): string {
  switch (lifecycle) {
    case "winners_announced":
      return "winners announced";
    default:
      return lifecycle;
  }
}
