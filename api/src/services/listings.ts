import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { type Listing, listings, type NewListing } from "../db/schema";
import {
  flagsToLifecycle,
  type InternalListingLifecycle,
  LIFECYCLE_TRANSITIONS,
  lifecycleToFlags,
} from "../lib/listing-lifecycle";
import { getNearnListing, isNearnAvailable, type NearnListing, NearnNotFoundError } from "./nearn";
import type { AgencyScope } from "./organization-access";
import type { ProjectDirectory } from "./project-directory";

const LISTING_STALENESS_MS = 5 * 60_000;

// Surfaces "NEARN slug already taken" cleanly so handlers can show the conflicting project.
export class NearnListingConflictError extends Error {
  constructor(
    readonly slug: string,
    readonly conflictingProjectId: string,
  ) {
    super(`NEARN listing "${slug}" is already attached to project ${conflictingProjectId}`);
    this.name = "NearnListingConflictError";
  }
}

type ListingDataFields = Pick<
  NewListing,
  | "title"
  | "description"
  | "type"
  | "status"
  | "token"
  | "rewardAmount"
  | "compensationType"
  | "minRewardAsk"
  | "maxRewardAsk"
  | "submissionLimit"
  | "totalPaymentsMade"
  | "totalWinnersSelected"
  | "rewards"
  | "maxBonusSpots"
  | "usdValue"
  | "skills"
  | "region"
  | "applicationType"
  | "multipleSubmissionRule"
  | "timeToComplete"
  | "requirements"
  | "sequentialId"
  | "nearnPublishedAt"
  | "deadline"
  | "isPublished"
  | "isArchived"
  | "isFeatured"
  | "isPrivate"
  | "isWinnersAnnounced"
  | "isHackathonPrize"
  | "hackathonSlug"
  | "hackathonName"
  | "hackathonStartDate"
  | "hackathonAnnounceDate"
  | "sponsorName"
  | "sponsorSlug"
  | "sponsorLogo"
  | "sponsorVerified"
  | "sponsorEntityName"
  | "sponsorIsCaution"
>;

// Number→BigInt precision-bounded: |n|≥1e21 → null; |n|<1e-6 uses toFixed (may carry IEEE-754 low-order noise).
function numberToDecimalString(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  if (!/[eE]/.test(s)) return s;
  if (Math.abs(n) >= 1e21) {
    console.warn("[listings] rewardAmount lost precision (≥1e21); dropping from rollup math:", n);
    return null;
  }
  return n.toFixed(24).replace(/\.?0+$/, "");
}

export function mapNearnPayloadToListingFields(payload: NearnListing): ListingDataFields {
  return {
    title: payload.title,
    description: payload.description,
    type: payload.type,
    status: payload.status,
    token: payload.token,
    rewardAmount:
      payload.rewardAmount === null ? null : numberToDecimalString(payload.rewardAmount),
    compensationType: payload.compensationType,
    minRewardAsk:
      payload.minRewardAsk === null ? null : numberToDecimalString(payload.minRewardAsk),
    maxRewardAsk:
      payload.maxRewardAsk === null ? null : numberToDecimalString(payload.maxRewardAsk),
    submissionLimit: payload.submissionLimit,
    totalPaymentsMade: payload.totalPaymentsMade,
    totalWinnersSelected: payload.totalWinnersSelected,
    rewards: payload.rewards,
    maxBonusSpots: payload.maxBonusSpots,
    usdValue: payload.usdValue,
    skills: payload.skills,
    region: payload.region,
    applicationType: payload.applicationType,
    multipleSubmissionRule: payload.multipleSubmissionRule,
    timeToComplete: payload.timeToComplete,
    requirements: payload.requirements,
    sequentialId: payload.sequentialId,
    nearnPublishedAt: payload.nearnPublishedAt ? new Date(payload.nearnPublishedAt) : null,
    deadline: payload.deadline ? new Date(payload.deadline) : null,
    isPublished: payload.isPublished,
    isArchived: payload.isArchived,
    isFeatured: payload.isFeatured,
    isPrivate: payload.isPrivate,
    isWinnersAnnounced: payload.isWinnersAnnounced,
    isHackathonPrize: payload.isHackathonPrize,
    hackathonSlug: payload.hackathonSlug,
    hackathonName: payload.hackathonName,
    hackathonStartDate: payload.hackathonStartDate ? new Date(payload.hackathonStartDate) : null,
    hackathonAnnounceDate: payload.hackathonAnnounceDate
      ? new Date(payload.hackathonAnnounceDate)
      : null,
    sponsorName: payload.sponsor?.name ?? null,
    sponsorSlug: payload.sponsor?.slug ?? null,
    sponsorLogo: payload.sponsor?.logo ?? null,
    sponsorVerified: payload.sponsor?.isVerified ?? null,
    sponsorEntityName: payload.sponsor?.entityName ?? null,
    sponsorIsCaution: payload.sponsor?.isCaution ?? null,
  };
}

export function listingRowToNearnPayload(row: Listing): NearnListing | null {
  if (row.source !== "nearn" || !row.externalId) return null;
  return {
    id: row.externalUuid,
    slug: row.externalId,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    token: row.token,
    rewardAmount: row.rewardAmount === null ? null : Number(row.rewardAmount),
    compensationType: row.compensationType,
    minRewardAsk: row.minRewardAsk === null ? null : Number(row.minRewardAsk),
    maxRewardAsk: row.maxRewardAsk === null ? null : Number(row.maxRewardAsk),
    submissionLimit: row.submissionLimit,
    totalPaymentsMade: row.totalPaymentsMade,
    totalWinnersSelected: row.totalWinnersSelected,
    rewards: row.rewards,
    maxBonusSpots: row.maxBonusSpots,
    usdValue: row.usdValue,
    skills: row.skills,
    region: row.region,
    applicationType: row.applicationType,
    multipleSubmissionRule: row.multipleSubmissionRule,
    timeToComplete: row.timeToComplete,
    requirements: row.requirements,
    sequentialId: row.sequentialId,
    nearnPublishedAt: row.nearnPublishedAt ? row.nearnPublishedAt.toISOString() : null,
    isFeatured: row.isFeatured,
    isPrivate: row.isPrivate,
    isHackathonPrize: row.isHackathonPrize,
    hackathonSlug: row.hackathonSlug,
    hackathonName: row.hackathonName,
    hackathonStartDate: row.hackathonStartDate ? row.hackathonStartDate.toISOString() : null,
    hackathonAnnounceDate: row.hackathonAnnounceDate
      ? row.hackathonAnnounceDate.toISOString()
      : null,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    isPublished: row.isPublished,
    isArchived: row.isArchived,
    isWinnersAnnounced: row.isWinnersAnnounced,
    sponsor:
      row.sponsorName !== null || row.sponsorSlug !== null
        ? {
            name: row.sponsorName,
            slug: row.sponsorSlug,
            logo: row.sponsorLogo,
            isVerified: row.sponsorVerified,
            entityName: row.sponsorEntityName,
            isCaution: row.sponsorIsCaution,
          }
        : null,
  };
}

// Refresh cached NEARN payload by slug; 404 → isArchived=true; testnet no-ops.
export async function refreshNearnListing(
  slug: string,
  orgAccountId: string,
  db: Database,
): Promise<Listing | null> {
  const existing = await db
    .select()
    .from(listings)
    .where(and(eq(listings.source, "nearn"), eq(listings.externalId, slug)))
    .limit(1);
  const row = existing[0];
  if (!row) return null;
  if (!isNearnAvailable(orgAccountId)) return row;

  const now = new Date();
  try {
    const payload = await getNearnListing(slug);
    const fields = mapNearnPayloadToListingFields(payload);
    const [updated] = await db
      .update(listings)
      .set({
        ...fields,
        externalUuid: payload.id,
        syncedAt: now,
        updatedAt: now,
      })
      .where(eq(listings.id, row.id))
      .returning();
    return updated ?? row;
  } catch (err) {
    if (err instanceof NearnNotFoundError) {
      const [updated] = await db
        .update(listings)
        .set({ isArchived: true, syncedAt: now, updatedAt: now })
        .where(eq(listings.id, row.id))
        .returning();
      return updated ?? row;
    }
    throw err;
  }
}

// Pre-checks slug collision to surface a typed conflict before the NEARN fetch.
export async function attachNearnListing(
  projectId: string,
  slug: string,
  db: Database,
): Promise<Listing> {
  const collision = await db
    .select({ projectId: listings.projectId })
    .from(listings)
    .where(and(eq(listings.source, "nearn"), eq(listings.externalId, slug)))
    .limit(1);
  if (collision[0] && collision[0].projectId !== projectId) {
    throw new NearnListingConflictError(slug, collision[0].projectId);
  }

  const payload = await getNearnListing(slug);
  const fields = mapNearnPayloadToListingFields(payload);
  const now = new Date();
  const [row] = await db
    .insert(listings)
    .values({
      id: crypto.randomUUID(),
      projectId,
      source: "nearn",
      externalId: slug,
      externalUuid: payload.id,
      ...fields,
      syncedAt: now,
    })
    .onConflictDoUpdate({
      target: [listings.projectId, listings.source],
      set: {
        externalId: slug,
        externalUuid: payload.id,
        ...fields,
        syncedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error("listings upsert returned no row");
  return row;
}

export async function detachNearnListing(projectId: string, db: Database): Promise<void> {
  await db
    .delete(listings)
    .where(and(eq(listings.projectId, projectId), eq(listings.source, "nearn")));
}

export type InternalListingType = "Bounty" | "Project" | "Sponsorship";

export interface InternalListingFields {
  title: string;
  type: InternalListingType;
  token: string;
  rewardAmount: string;
  description?: string | null;
  deadline?: Date | null;
  isPublished?: boolean;
  isArchived?: boolean;
  isWinnersAnnounced?: boolean;
}

export async function createInternalListing(
  projectId: string,
  fields: InternalListingFields,
  db: Database,
): Promise<Listing> {
  const now = new Date();
  const [row] = await db
    .insert(listings)
    .values({
      id: crypto.randomUUID(),
      projectId,
      source: "internal",
      externalId: null,
      title: fields.title,
      description: fields.description ?? null,
      type: fields.type,
      token: fields.token,
      rewardAmount: fields.rewardAmount,
      compensationType: "fixed",
      deadline: fields.deadline ?? null,
      isPublished: fields.isPublished ?? false,
      isArchived: fields.isArchived ?? false,
      isWinnersAnnounced: fields.isWinnersAnnounced ?? false,
      syncedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("internal listing insert returned no row");
  return row;
}

export async function updateInternalListing(
  projectId: string,
  fields: Partial<InternalListingFields>,
  db: Database,
): Promise<Listing | null> {
  const patch: Partial<NewListing> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.type !== undefined) patch.type = fields.type;
  if (fields.token !== undefined) patch.token = fields.token;
  if (fields.rewardAmount !== undefined) patch.rewardAmount = fields.rewardAmount;
  if (fields.deadline !== undefined) patch.deadline = fields.deadline;
  if (fields.isPublished !== undefined) patch.isPublished = fields.isPublished;
  if (fields.isArchived !== undefined) patch.isArchived = fields.isArchived;
  if (fields.isWinnersAnnounced !== undefined) patch.isWinnersAnnounced = fields.isWinnersAnnounced;

  if (Object.keys(patch).length === 0) {
    const rows = await db
      .select()
      .from(listings)
      .where(and(eq(listings.projectId, projectId), eq(listings.source, "internal")))
      .limit(1);
    return rows[0] ?? null;
  }

  patch.updatedAt = new Date();
  const [row] = await db
    .update(listings)
    .set(patch)
    .where(and(eq(listings.projectId, projectId), eq(listings.source, "internal")))
    .returning();
  return row ?? null;
}

export async function deleteInternalListing(projectId: string, db: Database): Promise<boolean> {
  const deleted = await db
    .delete(listings)
    .where(and(eq(listings.projectId, projectId), eq(listings.source, "internal")))
    .returning({ id: listings.id });
  return deleted.length > 0;
}

// Cascade project status to every listing (both sources). Idempotent.
export async function setListingsArchived(
  projectId: string,
  isArchived: boolean,
  db: Database,
): Promise<void> {
  await db
    .update(listings)
    .set({ isArchived, updatedAt: new Date() })
    .where(eq(listings.projectId, projectId));
}

export function isStale(row: Listing): boolean {
  if (!row.syncedAt) return true;
  return Date.now() - row.syncedAt.getTime() > LISTING_STALENESS_MS;
}

async function maybeRefresh(row: Listing, orgAccountId: string, db: Database): Promise<Listing> {
  if (row.source !== "nearn" || !row.externalId || !isStale(row)) return row;
  if (!isNearnAvailable(orgAccountId)) return row;
  try {
    const refreshed = await refreshNearnListing(row.externalId, orgAccountId, db);
    return refreshed ?? row;
  } catch (err) {
    console.warn(`[listings] refresh failed for slug=${row.externalId}:`, err);
    return row;
  }
}

export interface GetListingOpts {
  skipRefresh?: boolean;
}

export async function getListingForProject(
  projectId: string,
  source: "nearn" | "internal",
  orgAccountId: string,
  db: Database,
  opts: GetListingOpts = {},
): Promise<Listing | null> {
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.projectId, projectId), eq(listings.source, source)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (opts.skipRefresh) return row;
  return maybeRefresh(row, orgAccountId, db);
}

export async function getListingsForProjects(
  projectIds: string[],
  source: "nearn" | "internal",
  orgAccountId: string,
  db: Database,
  opts: GetListingOpts = {},
): Promise<Map<string, Listing>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(listings)
    .where(and(inArray(listings.projectId, projectIds), eq(listings.source, source)));
  if (opts.skipRefresh) {
    return new Map(rows.map((r) => [r.projectId, r]));
  }
  const fresh = await Promise.all(rows.map((r) => maybeRefresh(r, orgAccountId, db)));
  return new Map(fresh.map((r) => [r.projectId, r]));
}

const noInternalListing = () =>
  new ORPCError("NOT_FOUND", { message: "No internal listing exists for this project" });

const withLifecycle = (listing: Listing) => ({ ...listing, lifecycle: flagsToLifecycle(listing) });

type InternalListingInput = {
  title: string;
  type: InternalListingType;
  token: string;
  rewardAmount: string;
  description?: string | null;
  deadline?: Date | null;
};

export function createListingsService(db: Database, directory: ProjectDirectory) {
  const requireProject = (scope: AgencyScope, projectId: string) =>
    Effect.promise(() => directory.forAgency(scope).require(projectId));

  const attachFailure = (scope: AgencyScope, err: unknown) =>
    Effect.promise(async () => {
      if (!(err instanceof NearnListingConflictError)) {
        return new ORPCError("BAD_REQUEST", {
          message: `NEARN listing attach failed: ${(err as Error).message}`,
        });
      }
      const conflicting = await directory
        .forAgency(scope)
        .require(err.conflictingProjectId)
        .catch(() => null);
      const label = conflicting
        ? `${conflicting.title} (@${conflicting.slug})`
        : err.conflictingProjectId;
      return new ORPCError("BAD_REQUEST", {
        message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
      });
    });

  const readInternal = (projectId: string) =>
    Effect.promise(() =>
      db
        .select()
        .from(listings)
        .where(and(eq(listings.projectId, projectId), eq(listings.source, "internal")))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    );

  return {
    nearnFor: (scope: AgencyScope, projectId: string, opts: GetListingOpts = {}) =>
      Effect.promise(() => getListingForProject(projectId, "nearn", scope.agencyDao, db, opts)),

    forProjects: (
      scope: AgencyScope,
      projectIds: string[],
      source: "nearn" | "internal",
      opts: GetListingOpts = {},
    ) =>
      Effect.promise(() => getListingsForProjects(projectIds, source, scope.agencyDao, db, opts)),

    attachNearn: (scope: AgencyScope, projectId: string, slug: string) =>
      Effect.gen(function* () {
        if (!isNearnAvailable(scope.agencyDao)) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "NEARN is mainnet-only; cannot attach a listing on testnet",
            }),
          );
        }
        return yield* Effect.tryPromise({
          try: () => attachNearnListing(projectId, slug, db),
          catch: (err) => err,
        }).pipe(Effect.catchAll((err) => Effect.flatMap(attachFailure(scope, err), Effect.fail)));
      }),

    detachNearn: (projectId: string) => Effect.promise(() => detachNearnListing(projectId, db)),

    followProjectStatus: (projectId: string, status: string | undefined) =>
      Effect.promise(async () => {
        if (status === "archived") await setListingsArchived(projectId, true, db);
        else if (status === "active" || status === "paused") {
          await setListingsArchived(projectId, false, db);
        }
      }),

    getInternal: (scope: AgencyScope, projectId: string) =>
      Effect.gen(function* () {
        yield* requireProject(scope, projectId);
        const listing = yield* readInternal(projectId);
        return { listing: listing ? withLifecycle(listing) : null };
      }),

    createInternal: (
      scope: AgencyScope,
      input: InternalListingInput & { projectId: string; lifecycle?: InternalListingLifecycle },
    ) =>
      Effect.gen(function* () {
        yield* requireProject(scope, input.projectId);
        const listing = yield* Effect.promise(() =>
          createInternalListing(
            input.projectId,
            {
              title: input.title,
              type: input.type,
              token: input.token,
              rewardAmount: input.rewardAmount,
              description: input.description ?? null,
              deadline: input.deadline ?? null,
              ...lifecycleToFlags(input.lifecycle ?? "draft"),
            },
            db,
          ),
        );
        return { listing: withLifecycle(listing) };
      }),

    updateInternal: (
      scope: AgencyScope,
      input: Partial<InternalListingInput> & {
        projectId: string;
        lifecycle?: InternalListingLifecycle;
      },
    ) =>
      Effect.gen(function* () {
        const { projectId, lifecycle, ...fields } = input;
        yield* requireProject(scope, projectId);
        const existing = yield* readInternal(projectId);
        if (!existing) return yield* Effect.fail(noInternalListing());

        if (lifecycle) {
          const current = flagsToLifecycle(existing);
          if (lifecycle !== current && !LIFECYCLE_TRANSITIONS[current].includes(lifecycle)) {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", {
                message: `Cannot move listing from ${current} to ${lifecycle}`,
              }),
            );
          }
        }

        const updated = yield* Effect.promise(() =>
          updateInternalListing(
            projectId,
            { ...fields, ...(lifecycle ? lifecycleToFlags(lifecycle) : {}) },
            db,
          ),
        );
        if (!updated) return yield* Effect.fail(noInternalListing());
        return { listing: withLifecycle(updated) };
      }),

    deleteInternal: (scope: AgencyScope, projectId: string) =>
      Effect.gen(function* () {
        yield* requireProject(scope, projectId);
        const removed = yield* Effect.promise(() => deleteInternalListing(projectId, db));
        if (!removed) return yield* Effect.fail(noInternalListing());
        return { deleted: true as const };
      }),
  };
}

export type ListingsService = ReturnType<typeof createListingsService>;
