import { desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { billings, budgets, contributors, projectContributors } from "../db/schema";
import { getDaoAccountId } from "../lib/org";
import type { PluginsClient } from "../lib/plugins-types.gen";
import {
  attachNearnListing,
  detachNearnListing,
  getListingForProject,
  getListingsForProjects,
  listingRowToNearnPayload,
  NearnListingConflictError,
  setListingsArchived,
} from "./listings";
import { isNearnAvailable } from "./nearn";
import { deleteProjectCascade } from "./projects";
import { resolveActiveListing, rollupForToken } from "./rollups";
import { enrichWithChainStatus, networkOf } from "./sputnik";

type UpstreamProject = {
  id: string;
  ownerId: string;
  organizationId: string | null;
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

function toContractProject(
  p: UpstreamProject,
  nearnListingId: string | null,
  fallbackOrgId: string,
) {
  return {
    id: p.id,
    ownerId: p.ownerId,
    organizationId: p.organizationId ?? fallbackOrgId,
    slug: p.slug,
    title: p.title,
    description: p.description,
    repository: p.repository ?? null,
    nearnListingId,
    kind: (p.kind ?? "project") as "project" | "idea",
    status: p.status as "active" | "paused" | "archived",
    visibility: p.visibility as "public" | "unlisted" | "private",
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

export function createAgencyService(db: Database, plugins: PluginsClient) {
  async function fetchOrgProjects(
    orgAccountId: string,
    context: Record<string, unknown>,
    extra?: { visibility?: string; status?: string },
  ): Promise<UpstreamProject[]> {
    const out: UpstreamProject[] = [];
    let cursor: string | undefined;
    do {
      const result = await plugins.projects(context).listProjects({
        organizationId: orgAccountId,
        ...(extra?.visibility ? { visibility: extra.visibility as any } : {}),
        ...(extra?.status ? { status: extra.status as any } : {}),
        limit: 100,
        cursor,
      });
      out.push(...(result.data as unknown as UpstreamProject[]));
      cursor = result.meta.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  function canSeePrivateProjects(context: Record<string, unknown>): boolean {
    const memberRole = (context as any).organization?.member?.role as string | undefined;
    return memberRole === "admin" || memberRole === "owner" || memberRole === "contributor";
  }

  async function fetchVisibleProjects(
    orgAccountId: string,
    context: Record<string, unknown>,
  ): Promise<{ projects: UpstreamProject[]; canSeePrivate: boolean }> {
    const canSeePrivate = canSeePrivateProjects(context);
    const projects = canSeePrivate
      ? await fetchOrgProjects(orgAccountId, context)
      : await fetchOrgProjects(orgAccountId, context, { visibility: "public", status: "active" });
    return { projects, canSeePrivate };
  }

  async function nearnConflictError(
    err: unknown,
    orgAccountId: string,
    context: Record<string, unknown>,
  ) {
    if (err instanceof NearnListingConflictError) {
      const orgProjects = await fetchOrgProjects(orgAccountId, context);
      const conflicting = orgProjects.find((p) => p.id === err.conflictingProjectId);
      const label = conflicting
        ? `${conflicting.title} (@${conflicting.slug})`
        : err.conflictingProjectId;
      return new ORPCError("BAD_REQUEST", {
        message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
      });
    }
    return new ORPCError("BAD_REQUEST", {
      message: `NEARN listing attach failed: ${(err as Error).message}`,
    });
  }

  async function requireProjectInOrg(
    projectId: string,
    orgAccountId: string,
    context: Record<string, unknown>,
  ): Promise<UpstreamProject> {
    try {
      const result = await plugins.projects(context).getProject({ id: projectId });
      if (result.data.organizationId !== orgAccountId) {
        throw new ORPCError("NOT_FOUND", { message: "Project not found" });
      }
      return result.data as unknown as UpstreamProject;
    } catch (err) {
      if (err instanceof ORPCError) throw err;
      throw new ORPCError("NOT_FOUND", { message: "Project not found" });
    }
  }

  return {
    getDaoAccountId,
    fetchOrgProjects,
    requireProjectInOrg,

    listProjects: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        const { projects: upstream, canSeePrivate } = yield* Effect.promise(() =>
          fetchVisibleProjects(orgAccountId, context),
        );

        const projectIds = upstream.map((p) => p.id);
        const linkByProjectId = isNearnAvailable(orgAccountId)
          ? yield* Effect.promise(() =>
              getListingsForProjects(projectIds, "nearn", orgAccountId, db, {
                skipRefresh: !canSeePrivate,
              }),
            )
          : new Map();

        const data = upstream
          .map((p) => {
            const link = linkByProjectId.get(p.id);
            return {
              ...toContractProject(p, link?.externalId ?? null, orgAccountId),
              nearnListing: link ? listingRowToNearnPayload(link) : null,
            };
          })
          .sort(
            (a: { updatedAt: Date }, b: { updatedAt: Date }) =>
              b.updatedAt.getTime() - a.updatedAt.getTime(),
          );
        return { data };
      }),

    getProject: (context: Record<string, unknown>, slug: string) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        const { projects: upstream, canSeePrivate } = yield* Effect.promise(() =>
          fetchVisibleProjects(orgAccountId, context),
        );

        const upstreamMatch = upstream.find((p) => p.slug === slug);

        if (!upstreamMatch) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }

        if (!canSeePrivate) {
          return {
            project: {
              ...toContractProject(upstreamMatch, null, orgAccountId),
              description: null,
              nearnListingId: null,
            },
            contributors: null,
          };
        }

        const link = yield* Effect.promise(() =>
          getListingForProject(upstreamMatch.id, "nearn", orgAccountId, db, {
            skipRefresh: true,
          }),
        );

        const contributorRows = yield* Effect.promise(() =>
          db
            .select({
              id: contributors.id,
              name: contributors.name,
              nearAccountId: contributors.nearAccountId,
              role: projectContributors.role,
            })
            .from(projectContributors)
            .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
            .where(eq(projectContributors.projectId, upstreamMatch.id))
            .orderBy(desc(projectContributors.createdAt)),
        );

        return {
          project: toContractProject(upstreamMatch, link?.externalId ?? null, orgAccountId),
          contributors: contributorRows,
        };
      }),

    getBudget: (context: Record<string, unknown>, projectId: string) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        yield* Effect.promise(() => requireProjectInOrg(projectId, orgAccountId, context));

        const [budgetRows, billsRaw, nearnListing, internalListing] = yield* Effect.promise(() =>
          Promise.all([
            db
              .select({ tokenId: budgets.tokenId, amount: budgets.amount })
              .from(budgets)
              .where(eq(budgets.projectId, projectId)),
            db.select().from(billings).where(eq(billings.projectId, projectId)),
            getListingForProject(projectId, "nearn", orgAccountId, db),
            getListingForProject(projectId, "internal", orgAccountId, db),
          ]),
        );

        const bills = yield* Effect.promise(() =>
          Promise.all(billsRaw.map((b) => enrichWithChainStatus(db, b, orgAccountId))),
        );
        const resolved = resolveActiveListing(
          nearnListing,
          internalListing,
          networkOf(orgAccountId),
        );
        const tokenIds = Array.from(
          new Set([
            ...budgetRows.map((b) => b.tokenId),
            ...bills.map((b) => b.tokenId),
            ...(resolved ? [resolved.tokenId] : []),
          ]),
        ).sort();

        return {
          budgets: tokenIds.map((tokenId) => {
            const r = rollupForToken({
              tokenId,
              budgetAmounts: budgetRows
                .filter((b) => b.tokenId === tokenId)
                .map((b) => BigInt(b.amount)),
              billings: (bills as any[])
                .filter((b: { tokenId: string }) => b.tokenId === tokenId)
                .map((b) => ({
                  amount: b.amount,
                  status: b.status,
                })),
              listing: resolved,
            });
            return {
              tokenId,
              budget: r.budget.toString(),
              allocated: r.allocated.toString(),
              committed: r.committed.toString(),
              paid: r.paid.toString(),
              remaining: r.remaining.toString(),
            };
          }),
        };
      }),

    createProject: (
      context: Record<string, unknown>,
      input: {
        slug: string;
        title: string;
        description?: string;
        repository: string;
        nearnListingId?: string;
        kind?: "project" | "idea";
        status?: string;
        visibility?: string;
      },
    ) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);

        const created = yield* Effect.promise(() =>
          plugins.projects(context).createProject({
            kind: input.kind ?? "project",
            title: input.title,
            slug: input.slug,
            description: input.description,
            repository: input.repository,
            visibility: (input.visibility ?? "private") as "public" | "unlisted" | "private",
            organizationId: orgAccountId,
          }),
        );

        const final: UpstreamProject = yield* Effect.promise(async () => {
          if (input.status && input.status !== (created as any).status) {
            return (await plugins.projects(context).updateProject({
              id: (created as any).id,
              status: input.status as any,
            })) as unknown as UpstreamProject;
          }
          return created as unknown as UpstreamProject;
        });

        let attachedSlug: string | null = null;
        if (input.nearnListingId) {
          if (!isNearnAvailable(orgAccountId)) {
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", {
                message: "NEARN is mainnet-only; cannot attach a listing on testnet",
              }),
            );
          }
          try {
            const row = yield* Effect.promise(() =>
              attachNearnListing(created.id, input.nearnListingId!, db),
            );
            attachedSlug = row.externalId;
          } catch (err) {
            return yield* Effect.fail(
              yield* Effect.promise(() => nearnConflictError(err, orgAccountId, context)),
            );
          }
        }

        return {
          project: toContractProject(final, attachedSlug, orgAccountId),
        };
      }),

    updateProject: (
      context: Record<string, unknown>,
      input: {
        id: string;
        title?: string;
        description?: string | null;
        repository?: string;
        nearnListingId?: string | null;
        status?: string;
        visibility?: string;
      },
    ) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        const existing = yield* Effect.promise(() =>
          requireProjectInOrg(input.id, orgAccountId, context),
        );

        const { id, nearnListingId: _nearnListingId, ...projectPatch } = input;
        const hasProjectChanges = Object.values(projectPatch).some((v) => v !== undefined);

        const upstreamPatch: Record<string, unknown> = {
          ...projectPatch,
          description: projectPatch.description === null ? "" : projectPatch.description,
        };

        const updated: UpstreamProject = hasProjectChanges
          ? ((yield* Effect.promise(() =>
              plugins.projects(context).updateProject({ id, ...upstreamPatch }),
            )) as unknown as UpstreamProject)
          : existing;

        let finalListingId: string | null = null;
        if ("nearnListingId" in input) {
          if (input.nearnListingId === null) {
            yield* Effect.promise(() => detachNearnListing(id, db));
            finalListingId = null;
          } else if (input.nearnListingId !== undefined) {
            if (!isNearnAvailable(orgAccountId)) {
              return yield* Effect.fail(
                new ORPCError("BAD_REQUEST", {
                  message: "NEARN is mainnet-only; cannot attach a listing on testnet",
                }),
              );
            }
            try {
              const row = yield* Effect.promise(() =>
                attachNearnListing(id, input.nearnListingId!, db),
              );
              finalListingId = row.externalId;
            } catch (err) {
              return yield* Effect.fail(
                yield* Effect.promise(() => nearnConflictError(err, orgAccountId, context)),
              );
            }
          }
        } else {
          const link = yield* Effect.promise(() =>
            getListingForProject(id, "nearn", orgAccountId, db, {
              skipRefresh: true,
            }),
          );
          finalListingId = link?.externalId ?? null;
        }

        if (input.status === "archived") {
          yield* Effect.promise(() => setListingsArchived(id, true, db));
        } else if (input.status === "active" || input.status === "paused") {
          yield* Effect.promise(() => setListingsArchived(id, false, db));
        }

        return {
          project: toContractProject(updated, finalListingId, orgAccountId),
        };
      }),

    deleteProject: (context: Record<string, unknown>, input: { id: string }) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        yield* Effect.promise(() => requireProjectInOrg(input.id, orgAccountId, context));

        yield* Effect.promise(() => deleteProjectCascade(db, input.id));
        yield* Effect.promise(() => plugins.projects(context).deleteProject({ id: input.id }));
        return { deleted: true as const };
      }),
  };
}

export type AgencyService = ReturnType<typeof createAgencyService>;
