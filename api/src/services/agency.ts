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

const DAO_PROJECTS_TTL_MS = 5_000;

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
    kind: ((p as any).kind ?? "project") as "project" | "idea",
    status: p.status as "active" | "paused" | "archived",
    visibility: p.visibility as "public" | "unlisted" | "private",
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

async function fetchOrgProjectsPaginated(
  plugins: PluginsClient,
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

export function createAgencyService(db: Database, plugins: PluginsClient) {
  const daoProjectsCache = new Map<string, { projects: UpstreamProject[]; expiresAt: number }>();

  function invalidateOrgProjects(orgAccountId: string): void {
    daoProjectsCache.delete(orgAccountId);
  }

  async function fetchOrgProjects(
    orgAccountId: string,
    context: Record<string, unknown>,
  ): Promise<UpstreamProject[]> {
    const cached = daoProjectsCache.get(orgAccountId);
    if (cached && cached.expiresAt > Date.now()) return cached.projects;
    const projects = await fetchOrgProjectsPaginated(plugins, orgAccountId, context);
    daoProjectsCache.set(orgAccountId, {
      projects,
      expiresAt: Date.now() + DAO_PROJECTS_TTL_MS,
    });
    return projects;
  }

  async function fetchOrgProjectsById(
    orgAccountId: string,
    context: Record<string, unknown>,
  ): Promise<Map<string, UpstreamProject>> {
    const ps = await fetchOrgProjects(orgAccountId, context);
    return new Map(ps.map((p) => [p.id, p]));
  }

  async function requireProjectInOrg(
    projectId: string,
    orgAccountId: string,
    context: Record<string, unknown>,
  ): Promise<UpstreamProject> {
    const cached = daoProjectsCache.get(orgAccountId);
    if (cached && cached.expiresAt > Date.now()) {
      const hit = cached.projects.find((p) => p.id === projectId);
      if (hit) return hit;
    }
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

    fetchOrgProjects: (orgAccountId: string, context: Record<string, unknown>) =>
      fetchOrgProjects(orgAccountId, context),

    fetchOrgProjectsById: (orgAccountId: string, context: Record<string, unknown>) =>
      fetchOrgProjectsById(orgAccountId, context),

    requireProjectInOrg: (
      projectId: string,
      orgAccountId: string,
      context: Record<string, unknown>,
    ) => requireProjectInOrg(projectId, orgAccountId, context),

    listProjects: (context: Record<string, unknown>) =>
      Effect.gen(function* () {
        const orgAccountId = yield* getDaoAccountId(context);
        const memberRole = (context as any).organization?.member?.role as string | undefined;
        const isContributor = memberRole === "admin" || memberRole === "contributor";

        const upstream = yield* Effect.promise(() =>
          isContributor
            ? fetchOrgProjects(orgAccountId, context)
            : fetchOrgProjectsPaginated(plugins, orgAccountId, context, {
                visibility: "public",
                status: "active",
              }),
        );

        const projectIds = upstream.map((p) => p.id);
        const linkByProjectId = isNearnAvailable(orgAccountId)
          ? yield* Effect.promise(() =>
              getListingsForProjects(projectIds, "nearn", orgAccountId, db, {
                skipRefresh: !isContributor,
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
        const memberRole = (context as any).organization?.member?.role as string | undefined;
        const isContributor = memberRole === "admin" || memberRole === "contributor";

        let upstreamMatch: UpstreamProject | undefined;
        if (isContributor) {
          const all = yield* Effect.promise(() => fetchOrgProjects(orgAccountId, context));
          upstreamMatch = all.find((p) => p.slug === slug);
        } else {
          const result = yield* Effect.promise(() =>
            fetchOrgProjectsPaginated(plugins, orgAccountId, context, {
              visibility: "public",
              status: "active",
            }),
          );
          upstreamMatch = result.find((p) => p.slug === slug);
        }

        if (!upstreamMatch) {
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Project not found" }));
        }

        if (!isContributor) {
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
        repository?: string;
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

        invalidateOrgProjects(orgAccountId);

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
            if (err instanceof NearnListingConflictError) {
              const conflicting = yield* Effect.promise(() =>
                fetchOrgProjectsById(orgAccountId, context),
              );
              const conflictingProject = conflicting.get(err.conflictingProjectId);
              const label = conflictingProject
                ? `${conflictingProject.title} (@${conflictingProject.slug})`
                : err.conflictingProjectId;
              return yield* Effect.fail(
                new ORPCError("BAD_REQUEST", {
                  message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
                }),
              );
            }
            return yield* Effect.fail(
              new ORPCError("BAD_REQUEST", {
                message: `NEARN listing attach failed: ${(err as Error).message}`,
              }),
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
              if (err instanceof NearnListingConflictError) {
                const byId = yield* Effect.promise(() =>
                  fetchOrgProjectsById(orgAccountId, context),
                );
                const conflicting = byId.get(err.conflictingProjectId);
                const label = conflicting
                  ? `${conflicting.title} (@${conflicting.slug})`
                  : err.conflictingProjectId;
                return yield* Effect.fail(
                  new ORPCError("BAD_REQUEST", {
                    message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
                  }),
                );
              }
              return yield* Effect.fail(
                new ORPCError("BAD_REQUEST", {
                  message: `NEARN listing attach failed: ${(err as Error).message}`,
                }),
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

        if (hasProjectChanges) invalidateOrgProjects(orgAccountId);

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
        invalidateOrgProjects(orgAccountId);
        return { deleted: true as const };
      }),
  };
}

export type AgencyService = ReturnType<typeof createAgencyService>;
