import { and, desc, eq, inArray } from "drizzle-orm";
import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract, type proposalPublicItem } from "./contract";
import { createDatabaseDriver, type Database } from "./db";
import { cursorOf, cursorWhere } from "./db/cursor";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import { applications, billings, budgets, contributors, projectContributors } from "./db/schema";
import { createAuthMiddleware } from "./lib/auth";
import { defaultOrgAccount, pinnedNetwork } from "./lib/default-org-account";
import { getNetwork } from "./lib/network";
import type { PluginsClient } from "./lib/plugins-types.gen";
import {
  defaultContactEmail,
  defaultNearnAccountId,
  defaultPublicSettings,
} from "./lib/settings-defaults";
import {
  BudgetInsufficientError,
  createBudget,
  deallocateBudget,
  listBudgets,
  transferBudget,
} from "./services/budgets";
import {
  attachNearnListing,
  createInternalListing,
  deleteInternalListing,
  detachNearnListing,
  getListingForProject,
  getListingsForProjects,
  type InternalListingFields,
  listingRowToNearnPayload,
  NearnListingConflictError,
  setListingsArchived,
  updateInternalListing,
} from "./services/listings";
import {
  getNearnListing,
  getNearnListingSubmissions,
  isNearnAvailable,
  listNearnBountiesForSponsor,
} from "./services/nearn";
import { notifyNewApplication } from "./services/notify";
import { deleteProjectCascade } from "./services/projects";
import {
  assembleAgencyRollups,
  computeAvailable,
  resolveActiveListing,
  rollupForToken,
  tokenIdsForRollup,
} from "./services/rollups";
import {
  getResolvedPublicSettings,
  getSettingsRow,
  upsertSettings,
} from "./services/settings-admin";
import {
  type DaoProposal,
  getDaoTokenIds,
  getFtMetadata,
  getLastProposalId,
  getProposal,
  getProposals,
  getRoles,
  getStorageBalance,
  getTreasuryBalances,
  networkOf,
} from "./services/sputnik";
import { summarizeProposals, summarizeTeam, summarizeTreasury } from "./services/summaries";
import { getTokenMetadata, type KnownToken, NATIVE_TOKEN_ID } from "./services/tokens";

// MAX_ITERATIONS bounds RPC cost when the recent window is governance-only.
const PROPOSAL_FETCH_PAGE_SIZE = 100;
const PROPOSAL_FETCH_MAX_ITERATIONS = 5;

async function fetchTransferProposals(
  db: Database,
  orgAccountId: string,
  fromIndex: number | undefined,
  limit: number,
): Promise<{ transfers: DaoProposal[]; lastProposalId: number; nextFromIndex: number | null }> {
  const lastProposalId = await getLastProposalId(orgAccountId);
  if (lastProposalId === 0) {
    return { transfers: [], lastProposalId: 0, nextFromIndex: null };
  }
  const transfers: DaoProposal[] = [];
  let cursor = fromIndex ?? lastProposalId;
  let iterations = 0;
  while (transfers.length < limit && cursor > 0 && iterations < PROPOSAL_FETCH_MAX_ITERATIONS) {
    const startIndex = Math.max(0, cursor - PROPOSAL_FETCH_PAGE_SIZE);
    const fetched = await getProposals(db, orgAccountId, startIndex, cursor - startIndex);
    for (const p of fetched.slice().reverse()) {
      if (p.kind.type === "Transfer") {
        transfers.push(p);
        if (transfers.length >= limit) break;
      }
    }
    cursor = startIndex;
    iterations++;
  }
  return {
    transfers,
    lastProposalId,
    nextFromIndex: cursor > 0 ? cursor : null,
  };
}

function toProposalPublicItem(p: DaoProposal): z.infer<typeof proposalPublicItem> {
  const transfer = p.kind.type === "Transfer" ? p.kind : null;
  return {
    proposalId: String(p.id),
    proposer: p.proposer,
    description: p.description,
    status: p.status,
    tokenId: transfer ? (transfer.tokenId === "" ? NATIVE_TOKEN_ID : transfer.tokenId) : "",
    receiverId: transfer?.receiverId ?? "",
    amount: transfer?.amount ?? "0",
    submissionTime: p.submissionTime,
    votes: p.votes,
  };
}

const nearIdentitySchema = z.object({
  accountId: z.string(),
  network: z.string(),
  publicKey: z.string(),
  isPrimary: z.boolean(),
});

const nearCapabilitiesSchema = z.object({
  primaryAccountId: z.string().nullable(),
  linkedAccounts: z.array(nearIdentitySchema),
  hasNearAccount: z.boolean(),
});

const orgContextSchema = z
  .object({
    activeOrganizationId: z.string().nullable().optional(),
    organization: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        slug: z.string().optional(),
        logo: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .nullable()
      .optional(),
    member: z
      .object({
        id: z.string(),
        role: z.string(),
      })
      .nullable()
      .optional(),
    isPersonal: z.boolean().optional(),
    hasOrganization: z.boolean().optional(),
  })
  .optional();

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
    APPLICATIONS_WEBHOOK_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NOTIFY_FROM_EMAIL: z.string().optional(),
  }),

  context: z.object({
    userId: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        role: z.string().optional(),
        email: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    organizationId: z.string().optional(),
    organization: orgContextSchema,
    near: nearCapabilitiesSchema.optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
  }),

  contract,

  initialize: (config, plugins) =>
    Effect.promise(async () => {
      const driver = await createDatabaseDriver(config.secrets.API_DATABASE_URL);
      const db = driver.db;
      const migrations = await loadMigrations();
      await migrate(db, migrations);
      console.log("[API] Services Initialized");
      console.log("[API] Plugins available:", Object.keys(plugins).join(", ") || "none");

      const notifyConfig = {
        webhookUrl: config.secrets.APPLICATIONS_WEBHOOK_URL,
        resendApiKey: config.secrets.RESEND_API_KEY,
        fromEmail: config.secrets.NOTIFY_FROM_EMAIL,
      };
      return { db, driver, plugins, notifyConfig };
    }),

  shutdown: (services) =>
    Effect.promise(async () => {
      console.log("[API] Shutdown");
      await services.driver.close();
    }),

  createRouter: (services, builder) => {
    const { db, notifyConfig, plugins } = services;
    const auth = createAuthMiddleware(builder);

    const getDaoAccountId = (context: Record<string, unknown>): string => {
      const meta = context.organization?.organization?.metadata as Record<string, unknown> | undefined;
      const fromMeta = meta?.daoAccountId;
      if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
      return defaultOrgAccount(getNetwork(context.reqHeaders as Headers | undefined));
    };

    

    // Gate: authenticated + active org + required org-scoped role(s).
    // Super admins (context.user.role === "admin") bypass org role checks.
    // Org roles come from context.organization.member.role (better-auth session context).
    const requireOrgRole = (...roles: string[]) =>
      builder.middleware(async ({ context, next }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { hint: "Sign in to continue" },
          });
        }
        if (context.user.role === "admin") return next();
        if (!context.organizationId || !context.organization?.member?.role) {
          throw new ORPCError("FORBIDDEN", {
            message: "Active organization with required role membership required",
            data: { hint: "Select an organization and ensure you have an assigned role" },
          });
        }
        const memberRole = context.organization.member.role;
        if (!roles.includes(memberRole)) {
          throw new ORPCError("FORBIDDEN", {
            message: `Requires role: ${roles.join(" or ")}`,
            data: { requiredRoles: roles, currentRole: memberRole },
          });
        }
        return next();
      });

    // Soft auth: fills org/role context if the user has a session, passes through otherwise.
    // Used by adaptive endpoints that return different data shapes based on role.
    const tryOrgAuth = builder.middleware(
      async ({ context, next }) => {
        if (!context.user || !context.userId) return next();
        return next();
      },
    );

    const gates = {
      admin: requireOrgRole("admin"),
      contributor: requireOrgRole("admin", "member"),
      org: auth.requireOrganization,
      superAdmin: builder.middleware(async ({ context, next }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { hint: "Sign in to continue" },
          });
        }
        if (context.user.role !== "admin") {
          throw new ORPCError("FORBIDDEN", {
            message: "Super admin access required",
            data: { hint: "This action requires platform-level admin privileges" },
          });
        }
        return next({ context: { ...context, isSuperAdmin: true } });
      }),
    } as const;

    const enrichWithChainStatus = async (b: typeof billings.$inferSelect, orgAccountId: string) => {
      const proposalId = Number.parseInt(b.proposalId, 10);
      if (Number.isNaN(proposalId)) return { ...b, status: "InProgress" as const };
      const proposal = await getProposal(db, orgAccountId, proposalId);
      const status = (proposal?.status ?? "InProgress") as
        | "InProgress"
        | "Approved"
        | "Rejected"
        | "Removed"
        | "Expired"
        | "Moved"
        | "Failed";
      return { ...b, status };
    };

    const computeBudget = async (projectId: string, orgId: string) => {
      const [budgetRows, billsRaw, nearnListing, internalListing] = await Promise.all([
        db
          .select({ tokenId: budgets.tokenId, amount: budgets.amount })
          .from(budgets)
          .where(eq(budgets.projectId, projectId)),
        db.select().from(billings).where(eq(billings.projectId, projectId)),
        getListingForProject(projectId, "nearn", orgId, db),
        getListingForProject(projectId, "internal", orgId, db),
      ]);
      const bills = await Promise.all(billsRaw.map((b) => enrichWithChainStatus(b, orgId)));
      const resolved = resolveActiveListing(nearnListing, internalListing, networkOf(orgId));
      const tokenIds = Array.from(
        new Set([
          ...budgetRows.map((b) => b.tokenId),
          ...bills.map((b) => b.tokenId),
          ...(resolved ? [resolved.tokenId] : []),
        ]),
      ).sort();
      return tokenIds.map((tokenId) => {
        const r = rollupForToken({
          tokenId,
          budgetAmounts: budgetRows
            .filter((b) => b.tokenId === tokenId)
            .map((b) => BigInt(b.amount)),
          billings: bills
            .filter((b) => b.tokenId === tokenId)
            .map((b) => ({ amount: b.amount, status: b.status })),
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
      });
    };

    // Derived from upstream's projects-plugin contract so the shape stays in lockstep with the
    // remote MF bundle; rotating fields in the upstream Zod schema surface here as type errors.
    // listProjects's row shape (no `apps`) is what every site consumes — getProject layers `apps` on top.
    type UpstreamProject = Awaited<
      ReturnType<ReturnType<PluginsClient["projects"]>["listProjects"]>
    >["data"][number];

    // Proxy context passed to the projects plugin. Scoped by DAO/env org account.
    // memberRole threads the better-auth org role for permission checks in the projects plugin.
    // organizationId prefers the better-auth UUID over the Sputnik DAO account string for ownerId.
    const proxyCtx = (
      orgAccountId: string,
      memberRole?: string | null,
      organizationId?: string | null,
    ) => ({
      userId: organizationId ?? orgAccountId,
      walletAddress: organizationId ?? orgAccountId,
      user: { id: organizationId ?? orgAccountId, role: memberRole ?? undefined },
    });

    const toContractProject = (
      p: UpstreamProject,
      nearnListingId: string | null,
      fallbackOrgId: string,
    ) => ({
      id: p.id,
      ownerId: p.ownerId,
      organizationId: p.organizationId ?? fallbackOrgId,
      slug: p.slug,
      title: p.title,
      description: p.description,
      repository: p.repository ?? null,
      nearnListingId,
      kind: ((p as any).kind ?? "project") as "project" | "idea",
      status: p.status,
      visibility: p.visibility,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    });

    const toPublicProject = (p: UpstreamProject, fallbackOrgId: string) => {
      const { description, nearnListingId, ...rest } = toContractProject(p, null, fallbackOrgId);
      return rest;
    };

    const fetchPlatformOrgProjects = async (org: {
      id: string;
      metadata: Record<string, unknown> | null;
    }) => {
      const daoAccountId = String((org.metadata as { daoAccountId?: string })?.daoAccountId ?? "");
      if (!daoAccountId || !plugins.projects) return [];
      const upstream = await fetchOrgProjects(daoAccountId, org.id);
      return upstream
        .map((p) => toPublicProject(p, daoAccountId))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    };

    // Short TTL caches the DAO project list across handler-burst calls; writes invalidate.
    const DAO_PROJECTS_TTL_MS = 5_000;
    const daoProjectsCache = new Map<string, { projects: UpstreamProject[]; expiresAt: number }>();
    const invalidateOrgProjects = (orgAccountId: string): void => {
      daoProjectsCache.delete(orgAccountId);
    };

    // DAO ctx admits private DAO projects via upstream's ownerId===userId branch.
    const fetchOrgProjects = async (
      orgAccountId: string,
      organizationId?: string | null,
    ): Promise<UpstreamProject[]> => {
      const cached = daoProjectsCache.get(orgAccountId);
      if (cached && cached.expiresAt > Date.now()) return cached.projects;
      const ctx = proxyCtx(orgAccountId, null, organizationId);
      const out: UpstreamProject[] = [];
      let cursor: string | undefined;
      do {
        const result = await plugins.projects(ctx).listProjects({
          organizationId: orgAccountId,
          limit: 100,
          cursor,
        });
        out.push(...result.data);
        cursor = result.meta.nextCursor ?? undefined;
      } while (cursor);
      daoProjectsCache.set(orgAccountId, {
        projects: out,
        expiresAt: Date.now() + DAO_PROJECTS_TTL_MS,
      });
      return out;
    };

    const fetchOrgProjectsById = async (
      orgAccountId: string,
      organizationId?: string | null,
    ): Promise<Map<string, UpstreamProject>> => {
      const ps = await fetchOrgProjects(orgAccountId, organizationId);
      return new Map(ps.map((p) => [p.id, p]));
    };

    const requireProjectInOrg = async (
      projectId: string,
      orgAccountId: string,
      organizationId?: string | null,
    ): Promise<UpstreamProject> => {
      // Fast path: a warm cache already contains every project in this org (filtered upstream by
      // `organizationId`), so a hit implicitly satisfies the org check. Cache miss / stale falls
      // through to a single getProject + explicit org guard.
      const cached = daoProjectsCache.get(orgAccountId);
      if (cached && cached.expiresAt > Date.now()) {
        const hit = cached.projects.find((p) => p.id === projectId);
        if (hit) return hit;
      }
      try {
        // Use "admin" role so the upstream grants access regardless of ownerId — callers are
        // already gated by our own admin/contributor middleware before reaching this point.
        const result = await plugins
          .projects(proxyCtx(orgAccountId, "admin", organizationId))
          .getProject({ id: projectId });
        if (result.data.organizationId !== orgAccountId) {
          throw new ORPCError("NOT_FOUND", { message: "Project not found" });
        }
        return result.data;
      } catch (err) {
        if (err instanceof ORPCError) throw err;
        throw new ORPCError("NOT_FOUND", { message: "Project not found" });
      }
    };

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      applications: {
        create: builder.applications.create.handler(async ({ input }) => {
          const id = crypto.randomUUID();
          await db.insert(applications).values({
            id,
            kind: input.kind,
            name: input.name,
            email: input.email,
            nearAccountId: input.nearAccountId ?? null,
            message: input.message ?? null,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          });
          await notifyNewApplication(
            {
              id,
              kind: input.kind,
              name: input.name,
              email: input.email,
              nearAccountId: input.nearAccountId ?? null,
              message: input.message ?? null,
            },
            { ...notifyConfig, contactEmail: defaultContactEmail() },
          );
          return { id, status: "new" as const };
        }),

        list: builder.applications.list.use(gates.contributor).handler(async ({ input }) => {
          const rows = await db
            .select()
            .from(applications)
            .where(
              and(
                input.kind ? eq(applications.kind, input.kind) : undefined,
                input.status ? eq(applications.status, input.status) : undefined,
                cursorWhere(applications.createdAt, applications.id, input.cursor),
              ),
            )
            .orderBy(desc(applications.createdAt), desc(applications.id))
            .limit(input.limit);
          const last = rows[rows.length - 1];
          return {
            data: rows,
            nextCursor:
              rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
          };
        }),

        update: builder.applications.update.use(gates.admin).handler(async ({ context, input }) => {
          const reviewed = input.status !== "new";
          const result = await db
            .update(applications)
            .set({
              status: input.status,
              reviewedBy: reviewed
                ? (context.near?.primaryAccountId ?? context.userId ?? null)
                : null,
              reviewedAt: reviewed ? new Date() : null,
            })
            .where(eq(applications.id, input.id))
            .returning();
          const row = result[0];
          if (!row) throw new ORPCError("NOT_FOUND", { message: "Application not found" });
          return { application: row };
        }),
      },

      agency: {
        projects: {
          list: builder.agency.projects.list.use(tryOrgAuth).handler(async ({ context }) => {
            if (!plugins.projects) return { data: [] };

            const orgAccountId = await getDaoAccountId(context);
            const organizationId = context.organizationId ?? null;

            const isContributor = ["admin", "contributor"].includes(
              context.organization?.member?.role ?? "",
            );

            const upstream: UpstreamProject[] = [];
            let cursor: string | undefined;
            do {
              const result = await plugins
                .projects(
                  proxyCtx(orgAccountId, context.organization?.member?.role ?? null, organizationId),
                )
                .listProjects({
                  organizationId: orgAccountId,
                  ...(isContributor ? {} : { visibility: "public", status: "active" }),
                  limit: 100,
                  cursor,
                });
              upstream.push(...result.data);
              cursor = result.meta.nextCursor ?? undefined;
            } while (cursor);
            const projectIds = upstream.map((p) => p.id);
            const linkByProjectId = isNearnAvailable(orgAccountId)
              ? await getListingsForProjects(projectIds, "nearn", orgAccountId, db, {
                  skipRefresh: !isContributor,
                })
              : new Map();
            const data = upstream
              .map((p) => {
                const link = linkByProjectId.get(p.id);
                return {
                  ...toContractProject(p, link?.externalId ?? null, orgAccountId),
                  nearnListing: link ? listingRowToNearnPayload(link) : null,
                };
              })
              .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            return { data };
          }),

          get: builder.agency.projects.get.use(tryOrgAuth).handler(async ({ context, input }) => {
            const orgAccountId = await getDaoAccountId(context);
            const organizationId = context.organizationId ?? null;
            const isContributor = ["admin", "contributor"].includes(
              context.organization?.member?.role ?? "",
            );

            let upstreamMatch: UpstreamProject | undefined;
            if (isContributor) {
              upstreamMatch = (await fetchOrgProjects(orgAccountId, organizationId)).find(
                (p) => p.slug === input.slug,
              );
            } else {
              if (!plugins.projects) return null as never;
              const result = await plugins
                .projects(
                  proxyCtx(orgAccountId, context.organization?.member?.role ?? null, organizationId),
                )
                .listProjects({
                  organizationId: orgAccountId,
                  visibility: "public",
                  status: "active",
                  limit: 100,
                });
              upstreamMatch = result.data.find((p) => p.slug === input.slug);
            }

            if (!upstreamMatch) {
              throw new ORPCError("NOT_FOUND", { message: "Project not found" });
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

            const link = await getListingForProject(upstreamMatch.id, "nearn", orgAccountId, db, {
              skipRefresh: true,
            });

            const contributorRows = await db
              .select({
                id: contributors.id,
                name: contributors.name,
                nearAccountId: contributors.nearAccountId,
                role: projectContributors.role,
              })
              .from(projectContributors)
              .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
              .where(eq(projectContributors.projectId, upstreamMatch.id))
              .orderBy(desc(projectContributors.createdAt));

            return {
              project: toContractProject(upstreamMatch, link?.externalId ?? null, orgAccountId),
              contributors: contributorRows,
            };
          }),

          getBudget: builder.agency.projects.getBudget
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.projectId, orgAccountId);
              return { budgets: await computeBudget(input.projectId, orgAccountId) };
            }),

          create: builder.agency.projects.create
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              const ctx = proxyCtx(
                orgAccountId,
                context.organization?.member?.role ?? null,
                context.organizationId ?? null,
              );
              const created = await plugins.projects(ctx).createProject({
                kind: input.kind ?? "project",
                title: input.title,
                slug: input.slug,
                description: input.description,
                repository: input.repository,
                visibility: input.visibility,
                organizationId: orgAccountId,
              });

              let final: UpstreamProject = created;
              if (input.status && input.status !== created.status) {
                // Upstream createProject doesn't accept `status`; apply non-default values via followup.
                final = await plugins.projects(ctx).updateProject({
                  id: created.id,
                  status: input.status,
                });
              }

              // Invalidate now: the upstream project is committed. A NEARN attach failure below
              // must not leave the cache stale for the next 5s.
              invalidateOrgProjects(orgAccountId);

              let attachedSlug: string | null = null;
              if (input.nearnListingId) {
                if (!isNearnAvailable(orgAccountId)) {
                  throw new ORPCError("BAD_REQUEST", {
                    message: "NEARN is mainnet-only; cannot attach a listing on testnet",
                  });
                }
                try {
                  const row = await attachNearnListing(created.id, input.nearnListingId, db);
                  attachedSlug = row.externalId;
                } catch (err) {
                  if (err instanceof NearnListingConflictError) {
                    const conflicting = (await fetchOrgProjectsById(orgAccountId)).get(
                      err.conflictingProjectId,
                    );
                    const label = conflicting
                      ? `${conflicting.title} (@${conflicting.slug})`
                      : err.conflictingProjectId;
                    throw new ORPCError("BAD_REQUEST", {
                      message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
                    });
                  }
                  throw new ORPCError("BAD_REQUEST", {
                    message: `NEARN listing attach failed: ${(err as Error).message}`,
                  });
                }
              }

              return {
                project: toContractProject(final, attachedSlug, orgAccountId),
              };
            }),

          update: builder.agency.projects.update
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              const ctx = proxyCtx(
                orgAccountId,
                context.organization?.member?.role ?? null,
                context.organizationId ?? null,
              );
              const { id, nearnListingId: _nearnListingId, ...projectPatch } = input;

              const existing = await requireProjectInOrg(id, orgAccountId);

              const hasProjectChanges = Object.values(projectPatch).some((v) => v !== undefined);
              // Upstream updateProject accepts only string description; clear via empty string.
              const upstreamPatch = {
                ...projectPatch,
                description: projectPatch.description === null ? "" : projectPatch.description,
              };
              const updated: UpstreamProject = hasProjectChanges
                ? await plugins.projects(ctx).updateProject({
                    id,
                    ...upstreamPatch,
                  })
                : existing;

              let finalListingId: string | null = null;
              if ("nearnListingId" in input) {
                if (input.nearnListingId === null) {
                  await detachNearnListing(id, db);
                  finalListingId = null;
                } else if (input.nearnListingId !== undefined) {
                  if (!isNearnAvailable(orgAccountId)) {
                    throw new ORPCError("BAD_REQUEST", {
                      message: "NEARN is mainnet-only; cannot attach a listing on testnet",
                    });
                  }
                  try {
                    const row = await attachNearnListing(id, input.nearnListingId, db);
                    finalListingId = row.externalId;
                  } catch (err) {
                    if (err instanceof NearnListingConflictError) {
                      const conflicting = (await fetchOrgProjectsById(orgAccountId)).get(
                        err.conflictingProjectId,
                      );
                      const label = conflicting
                        ? `${conflicting.title} (@${conflicting.slug})`
                        : err.conflictingProjectId;
                      throw new ORPCError("BAD_REQUEST", {
                        message: `NEARN listing "${err.slug}" is already attached to ${label}; detach there first.`,
                      });
                    }
                    throw new ORPCError("BAD_REQUEST", {
                      message: `NEARN listing attach failed: ${(err as Error).message}`,
                    });
                  }
                }
              } else {
                const link = await getListingForProject(id, "nearn", orgAccountId, db, {
                  skipRefresh: true,
                });
                finalListingId = link?.externalId ?? null;
              }

              // Cascade project archive state to listings; rollup filter is the durable guarantee.
              if (input.status === "archived") {
                await setListingsArchived(id, true, db);
              } else if (input.status === "active" || input.status === "paused") {
                await setListingsArchived(id, false, db);
              }

              if (hasProjectChanges) invalidateOrgProjects(orgAccountId);
              return {
                project: toContractProject(updated, finalListingId, orgAccountId),
              };
            }),

          delete: builder.agency.projects.delete
            .use(gates.admin)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.id, orgAccountId);

              // Cascade local rows first (atomic via the service's transaction), then upstream
              // delete. Re-running on upstream failure is safe: the cascade becomes a no-op.
              // Partial-failure cross-system state (agency empty, upstream still has project) is
              // converged by the re-run.
              await deleteProjectCascade(db, input.id);
              await plugins
                .projects(
                  proxyCtx(
                    orgAccountId,
                    context.organization?.member?.role ?? null,
                    context.organizationId ?? null,
                  ),
                )
                .deleteProject({ id: input.id });
              invalidateOrgProjects(orgAccountId);
              return { deleted: true as const };
            }),
        },

        listings: {
          get: builder.agency.listings.get
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.projectId, orgAccountId);
              const row = await getListingForProject(
                input.projectId,
                "internal",
                orgAccountId,
                db,
                { skipRefresh: true },
              );
              return { listing: row };
            }),

          create: builder.agency.listings.create
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.projectId, orgAccountId);

              const existing = await getListingForProject(
                input.projectId,
                "internal",
                orgAccountId,
                db,
                { skipRefresh: true },
              );
              if (existing) {
                throw new ORPCError("BAD_REQUEST", {
                  message: "Project already has an internal listing; update or delete it instead.",
                });
              }

              const fields: InternalListingFields = {
                title: input.title,
                type: input.type,
                token: input.token,
                rewardAmount: input.rewardAmount,
                description: input.description ?? null,
                deadline: input.deadline ?? null,
                isPublished: input.isPublished,
                isArchived: input.isArchived,
                isWinnersAnnounced: input.isWinnersAnnounced,
              };
              const row = await createInternalListing(input.projectId, fields, db);
              return { listing: row };
            }),

          update: builder.agency.listings.update
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.projectId, orgAccountId);

              const { projectId, ...patch } = input;
              const row = await updateInternalListing(projectId, patch, db);
              if (!row) {
                throw new ORPCError("NOT_FOUND", {
                  message: "No internal listing exists for this project",
                });
              }
              return { listing: row };
            }),

          delete: builder.agency.listings.delete
            .use(gates.contributor)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getDaoAccountId(context);
              await requireProjectInOrg(input.projectId, orgAccountId);

              const removed = await deleteInternalListing(input.projectId, db);
              if (!removed) {
                throw new ORPCError("NOT_FOUND", {
                  message: "No internal listing exists for this project",
                });
              }
              return { deleted: true as const };
            }),
        },
      },

      contributors: {
        list: builder.contributors.list.use(gates.contributor).handler(async () => {
          const rows = await db.select().from(contributors).orderBy(desc(contributors.updatedAt));
          return { data: rows };
        }),

        create: builder.contributors.create.use(gates.admin).handler(async ({ input }) => {
          const id = crypto.randomUUID();
          const now = new Date();
          const result = await db
            .insert(contributors)
            .values({
              id,
              name: input.name,
              email: input.email ?? null,
              nearAccountId: input.nearAccountId ?? null,
              onboardingStatus: input.onboardingStatus,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          const row = result[0];
          if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" });
          return { contributor: row };
        }),

        update: builder.contributors.update.use(gates.admin).handler(async ({ input }) => {
          const { id, ...patch } = input;
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) updates[k] = v;
          }
          const result = await db
            .update(contributors)
            .set(updates)
            .where(eq(contributors.id, id))
            .returning();
          const row = result[0];
          if (!row) throw new ORPCError("NOT_FOUND", { message: "Contributor not found" });
          return { contributor: row };
        }),
      },

      assignments: {
        list: builder.assignments.list
          .use(gates.contributor)
          .handler(async ({ context, input }) => {
            const orgId = await getDaoAccountId(context);
            await requireProjectInOrg(input.projectId, orgId);
            const rows = await db
              .select({
                projectId: projectContributors.projectId,
                contributorId: projectContributors.contributorId,
                role: projectContributors.role,
                createdAt: projectContributors.createdAt,
                contributor: contributors,
              })
              .from(projectContributors)
              .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
              .where(eq(projectContributors.projectId, input.projectId));
            return { data: rows };
          }),

        create: builder.assignments.create
          .use(gates.contributor)
          .handler(async ({ context, input }) => {
            const orgId = await getDaoAccountId(context);
            await requireProjectInOrg(input.projectId, orgId);

            const contributorExists = await db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.id, input.contributorId))
              .limit(1);
            if (contributorExists.length === 0)
              throw new ORPCError("NOT_FOUND", { message: "Contributor not found" });

            await db
              .insert(projectContributors)
              .values({
                projectId: input.projectId,
                contributorId: input.contributorId,
                role: input.role ?? null,
              })
              .onConflictDoUpdate({
                target: [projectContributors.projectId, projectContributors.contributorId],
                set: { role: input.role ?? null },
              });
            return {
              projectId: input.projectId,
              contributorId: input.contributorId,
              role: input.role ?? null,
            };
          }),

        delete: builder.assignments.delete.use(gates.contributor).handler(async ({ input }) => {
          await db
            .delete(projectContributors)
            .where(
              and(
                eq(projectContributors.projectId, input.projectId),
                eq(projectContributors.contributorId, input.contributorId),
              ),
            );
          return { ok: true as const };
        }),
      },

      budgets: {
        list: builder.budgets.list.use(gates.contributor).handler(async ({ context, input }) => {
          const orgId = await getDaoAccountId(context);
          // Validate projectId is in-DAO upfront — explicit 404 over silent empty.
          if (input.projectId)
            await requireProjectInOrg(
              input.projectId,
              orgId,
              context.organizationId ?? null,
            );
          const projectIds = input.projectId
            ? [input.projectId]
            : (await fetchOrgProjects(orgId, context.organizationId ?? null)).map(
                (p) => p.id,
              );
          return listBudgets(db, {
            projectIds,
            tokenId: input.tokenId,
            cursor: input.cursor,
            limit: input.limit,
          });
        }),

        create: builder.budgets.create.use(gates.admin).handler(async ({ context, input }) => {
          const orgId = await getDaoAccountId(context);
          await requireProjectInOrg(input.projectId, orgId);
          const budget = await createBudget(db, {
            projectId: input.projectId,
            tokenId: input.tokenId,
            amount: input.amount,
            note: input.note ?? null,
            actorAccountId: context.near?.primaryAccountId ?? context.userId ?? "unknown",
          });
          return { budget };
        }),

        deallocate: builder.budgets.deallocate
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            const orgId = await getDaoAccountId(context);
            await requireProjectInOrg(input.projectId, orgId);
            try {
              const budget = await deallocateBudget(db, {
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: context.near?.primaryAccountId ?? context.userId ?? "unknown",
              });
              return { budget };
            } catch (err) {
              if (err instanceof BudgetInsufficientError) {
                throw new ORPCError("BAD_REQUEST", { message: err.message });
              }
              throw err;
            }
          }),

        transfer: builder.budgets.transfer.use(gates.admin).handler(async ({ context, input }) => {
          const orgId = await getDaoAccountId(context);
          const ownedProjectIds = new Set((await fetchOrgProjects(orgId)).map((p) => p.id));
          if (
            !ownedProjectIds.has(input.fromProjectId) ||
            !ownedProjectIds.has(input.toProjectId)
          ) {
            throw new ORPCError("NOT_FOUND", {
              message: "fromProjectId and toProjectId must both belong to this agency",
            });
          }
          try {
            return await transferBudget(db, {
              fromProjectId: input.fromProjectId,
              toProjectId: input.toProjectId,
              tokenId: input.tokenId,
              amount: input.amount,
              note: input.note ?? null,
              actorAccountId: context.near?.primaryAccountId ?? context.userId ?? "unknown",
            });
          } catch (err) {
            if (err instanceof BudgetInsufficientError) {
              throw new ORPCError("BAD_REQUEST", { message: err.message });
            }
            throw err;
          }
        }),
      },

      billings: {
        list: builder.billings.list.use(gates.contributor).handler(async ({ context, input }) => {
          const selectBillingCols = {
            id: billings.id,
            projectId: billings.projectId,
            contributorId: billings.contributorId,
            tokenId: billings.tokenId,
            amount: billings.amount,
            proposalId: billings.proposalId,
            note: billings.note,
            createdAt: billings.createdAt,
          } as const;

          const orgId = await getDaoAccountId(context);
          if (input.projectId)
            await requireProjectInOrg(
              input.projectId,
              orgId,
              context.organizationId ?? null,
            );
          const projectIds = input.projectId
            ? [input.projectId]
            : (await fetchOrgProjects(orgId, context.organizationId ?? null)).map(
                (p) => p.id,
              );
          const rows = await db
            .select(selectBillingCols)
            .from(billings)
            .where(
              and(
                inArray(billings.projectId, projectIds),
                input.contributorId ? eq(billings.contributorId, input.contributorId) : undefined,
                cursorWhere(billings.createdAt, billings.id, input.cursor),
              ),
            )
            .orderBy(desc(billings.createdAt), desc(billings.id))
            .limit(input.limit);
          const last = rows[rows.length - 1];
          const enriched = await Promise.all(rows.map((b) => enrichWithChainStatus(b, orgId)));
          return {
            data: enriched,
            nextCursor:
              rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
          };
        }),

        create: builder.billings.create.use(gates.admin).handler(async ({ context, input }) => {
          const orgId = await getDaoAccountId(context);
          const orgProjectsById = await fetchOrgProjectsById(orgId);
          if (!orgProjectsById.has(input.projectId))
            throw new ORPCError("NOT_FOUND", { message: "Project not found" });

          const proposalIdNum = Number.parseInt(input.proposalId, 10);
          if (Number.isNaN(proposalIdNum))
            throw new ORPCError("BAD_REQUEST", { message: "Invalid proposal id" });

          const existing = await db
            .select({
              billingId: billings.id,
              projectId: billings.projectId,
            })
            .from(billings)
            .where(eq(billings.proposalId, input.proposalId))
            .limit(1);
          if (existing.length > 0) {
            const e = existing[0]!;
            const project = orgProjectsById.get(e.projectId);
            throw new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is already assigned to ${
                project?.title ?? e.projectId
              } (@${project?.slug ?? "?"})`,
            });
          }

          const proposal = await getProposal(db, orgId, proposalIdNum);
          if (!proposal)
            throw new ORPCError("NOT_FOUND", {
              message: `Proposal ${input.proposalId} not found on DAO`,
            });
          if (proposal.kind.type !== "Transfer")
            throw new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is not a funding request (kind: ${proposal.kind.name})`,
            });

          let contributorId = input.contributorId ?? null;
          if (!contributorId) {
            const found = await db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.nearAccountId, proposal.kind.receiverId))
              .limit(1);
            contributorId = found[0]?.id ?? null;
          }

          const id = crypto.randomUUID();
          const result = await db
            .insert(billings)
            .values({
              id,
              projectId: input.projectId,
              contributorId,
              tokenId: proposal.kind.tokenId === "" ? NATIVE_TOKEN_ID : proposal.kind.tokenId,
              amount: proposal.kind.amount,
              proposalId: input.proposalId,
              note: input.note ?? null,
              createdAt: new Date(),
            })
            .returning();
          const row = result[0];
          if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" });
          return { billing: await enrichWithChainStatus(row, orgId) };
        }),

        delete: builder.billings.delete.use(gates.admin).handler(async ({ context, input }) => {
          const orgId = await getDaoAccountId(context);
          const existing = await db
            .select({ id: billings.id, projectId: billings.projectId })
            .from(billings)
            .where(eq(billings.id, input.id))
            .limit(1);
          const row = existing[0];
          if (!row) throw new ORPCError("NOT_FOUND", { message: "Billing not found" });
          await requireProjectInOrg(row.projectId, orgId);
          await db.delete(billings).where(eq(billings.id, input.id));
          return { deleted: true as const };
        }),
      },

      proposals: {
        list: builder.proposals.list.handler(async ({ context, input }) => {
          const orgAccountId = await getDaoAccountId(context);
          const isContributor = ["admin", "contributor"].includes(
            context.organization?.member?.role ?? "",
          );

          try {
            const { transfers, lastProposalId, nextFromIndex } = await fetchTransferProposals(
              db,
              orgAccountId,
              input.fromIndex,
              input.limit,
            );

            if (!isContributor) {
              return {
                data: transfers.map((p) => ({ ...toProposalPublicItem(p), mapping: null })),
                lastProposalId,
                nextFromIndex,
              };
            }

            const proposalIdStrs = transfers.map((p) => String(p.id));
            const orgProjectsById = await fetchOrgProjectsById(orgAccountId);
            const localBillings =
              proposalIdStrs.length > 0
                ? await db
                    .select({
                      billingId: billings.id,
                      proposalId: billings.proposalId,
                      projectId: billings.projectId,
                    })
                    .from(billings)
                    .where(inArray(billings.proposalId, proposalIdStrs))
                : [];
            const mappingByProposal = new Map(
              localBillings
                .filter((b) => orgProjectsById.has(b.projectId))
                .map((b) => [b.proposalId, b]),
            );

            const data = transfers.map((p) => {
              const m = mappingByProposal.get(String(p.id));
              const project = m ? orgProjectsById.get(m.projectId) : undefined;
              return {
                ...toProposalPublicItem(p),
                mapping:
                  m && project
                    ? {
                        billingId: m.billingId,
                        projectId: m.projectId,
                        projectSlug: project.slug,
                        projectTitle: project.title,
                      }
                    : null,
              };
            });

            return { data, lastProposalId, nextFromIndex };
          } catch (err) {
            if (isContributor) throw err;
            return { data: [], lastProposalId: 0, nextFromIndex: null };
          }
        }),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) => {
          const orgAccountId = await getDaoAccountId(context);
          try {
            const lastProposalId = await getLastProposalId(orgAccountId);
            if (lastProposalId === 0) return summarizeProposals([], 0);
            const pageSize = Math.min(100, lastProposalId);
            const recent = await getProposals(
              db,
              orgAccountId,
              Math.max(0, lastProposalId - pageSize),
              pageSize,
            );
            return summarizeProposals(recent, lastProposalId);
          } catch {
            return summarizeProposals([], 0);
          }
        }),
      },

      nearn: {
        getListing: builder.nearn.getListing
          .use(gates.contributor)
          .handler(async ({ context, input }) => {
            const orgAccountId = await getDaoAccountId(context);
            if (!isNearnAvailable(orgAccountId)) {
              throw new ORPCError("NOT_FOUND", { message: "NEARN not available on this network" });
            }
            try {
              const listing = await getNearnListing(input.slug);
              return { listing };
            } catch (err) {
              const message = (err as Error).message ?? "";
              if (message.includes("not found")) {
                throw new ORPCError("NOT_FOUND", { message });
              }
              throw err;
            }
          }),

        listSponsorBounties: builder.nearn.listSponsorBounties
          .use(gates.contributor)
          .handler(async ({ context }) => {
            const orgAccountId = await getDaoAccountId(context);
            if (!isNearnAvailable(orgAccountId)) {
              return { sponsorSlug: null, bounties: [] };
            }
            const sponsorSlug = defaultNearnAccountId();
            if (!sponsorSlug) {
              return { sponsorSlug: null, bounties: [] };
            }
            const bounties = await listNearnBountiesForSponsor(sponsorSlug);
            return { sponsorSlug, bounties };
          }),

        listSubmissions: builder.nearn.listSubmissions
          .use(gates.contributor)
          .handler(async ({ context, input }) => {
            const orgAccountId = await getDaoAccountId(context);
            if (!isNearnAvailable(orgAccountId)) {
              throw new ORPCError("NOT_FOUND", { message: "NEARN not available on this network" });
            }
            try {
              const submissions = await getNearnListingSubmissions(input.slug);
              return { submissions };
            } catch (err) {
              const message = (err as Error).message ?? "";
              if (message.includes("not found")) {
                throw new ORPCError("NOT_FOUND", { message });
              }
              throw err;
            }
          }),
      },

      tokens: {
        list: builder.tokens.list.handler(async ({ context }) => {
          const orgAccountId = await getDaoAccountId(context);
          const orgNetwork = networkOf(orgAccountId);
          const ids = await getDaoTokenIds(orgAccountId);
          const resolved = await Promise.all(
            ids.map(async (id): Promise<KnownToken | null> => {
              // NATIVE_TOKEN_ID is universal; rewrite chainNetwork to match active org, don't filter.
              if (id === NATIVE_TOKEN_ID) {
                const native = getTokenMetadata(id);
                return native ? { ...native, chainNetwork: orgNetwork } : null;
              }
              const known = getTokenMetadata(id);
              // Reject known entries on wrong network (contract name suffix isn't a network marker).
              if (known && known.chainNetwork === orgNetwork) return known;
              const ft = await getFtMetadata(id, orgAccountId);
              // Drop tokens with no fetchable metadata; fabricating decimals breaks rollups silently.
              if (!ft) return null;
              return {
                tokenId: id,
                network: "near",
                chainNetwork: orgNetwork,
                symbol: ft.symbol,
                decimals: ft.decimals,
                name: ft.name,
                icon: ft.icon,
              };
            }),
          );
          return { tokens: resolved.filter((t): t is KnownToken => t !== null) };
        }),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) => {
          const orgAccountId = await getDaoAccountId(context);
          // NEP-145 doesn't apply to native NEAR; surface null so clients can label "n/a".
          if (input.tokenId === NATIVE_TOKEN_ID) {
            return { tokenId: input.tokenId, status: null };
          }
          const status = await getStorageBalance(orgAccountId, input.tokenId);
          return { tokenId: input.tokenId, status };
        }),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(
          async ({ context, input }) => {
            const orgAccountId = await getDaoAccountId(context);
            try {
              const balances = await getTreasuryBalances(orgAccountId, input.tokenIds);
              return {
                balances: input.tokenIds.map((tokenId) => ({
                  tokenId,
                  balance: balances[tokenId] ?? "0",
                })),
              };
            } catch {
              // RPC failures degrade to zero balances for public visitors; admins see errors.
              return {
                balances: input.tokenIds.map((tokenId) => ({ tokenId, balance: "0" })),
              };
            }
          },
        ),

        getBalances: builder.treasury.getBalances
          .use(gates.contributor)
          .handler(async ({ context, input }) => {
            const orgId = await getDaoAccountId(context);
            const orgProjectIds = (await fetchOrgProjects(orgId)).map((p) => p.id);
            const [balances, budgetRows, billingRows] =
              orgProjectIds.length > 0
                ? await Promise.all([
                    getTreasuryBalances(orgId, input.tokenIds),
                    db
                      .select({ tokenId: budgets.tokenId, amount: budgets.amount })
                      .from(budgets)
                      .where(inArray(budgets.projectId, orgProjectIds)),
                    db
                      .select({
                        id: billings.id,
                        projectId: billings.projectId,
                        contributorId: billings.contributorId,
                        tokenId: billings.tokenId,
                        amount: billings.amount,
                        proposalId: billings.proposalId,
                        note: billings.note,
                        createdAt: billings.createdAt,
                      })
                      .from(billings)
                      .where(inArray(billings.projectId, orgProjectIds)),
                  ])
                : [
                    await getTreasuryBalances(orgId, input.tokenIds),
                    [] as { tokenId: string; amount: string }[],
                    [] as (typeof billings.$inferSelect)[],
                  ];
            const bills = await Promise.all(
              billingRows.map((b) => enrichWithChainStatus(b, orgId)),
            );

            const budgetedByToken = new Map<string, bigint>();
            for (const row of budgetRows) {
              budgetedByToken.set(
                row.tokenId,
                (budgetedByToken.get(row.tokenId) ?? 0n) + BigInt(row.amount),
              );
            }
            const paidByToken = new Map<string, bigint>();
            for (const b of bills) {
              if (b.status === "Approved") {
                paidByToken.set(b.tokenId, (paidByToken.get(b.tokenId) ?? 0n) + BigInt(b.amount));
              }
            }

            return {
              balances: input.tokenIds.map((tokenId) => {
                const budgeted = budgetedByToken.get(tokenId) ?? 0n;
                const paid = paidByToken.get(tokenId) ?? 0n;
                const balance = BigInt(balances[tokenId] ?? "0");
                return {
                  tokenId,
                  balance: balance.toString(),
                  totalBudgeted: budgeted.toString(),
                  available: computeAvailable(balance, budgeted, paid).toString(),
                };
              }),
            };
          }),

        getRollups: builder.treasury.getRollups
          .use(gates.contributor)
          .handler(async ({ context }) => {
            const orgId = await getDaoAccountId(context);
            // Archived projects are excluded from the canonical financial surface.
            const orgProjectIds = (await fetchOrgProjects(orgId))
              .filter((p) => p.status !== "archived")
              .map((p) => p.id);
            const [budgetRows, billingRows, nearnListings, internalListings] =
              orgProjectIds.length > 0
                ? await Promise.all([
                    db
                      .select({
                        projectId: budgets.projectId,
                        tokenId: budgets.tokenId,
                        amount: budgets.amount,
                      })
                      .from(budgets)
                      .where(inArray(budgets.projectId, orgProjectIds)),
                    db
                      .select({
                        id: billings.id,
                        projectId: billings.projectId,
                        contributorId: billings.contributorId,
                        tokenId: billings.tokenId,
                        amount: billings.amount,
                        proposalId: billings.proposalId,
                        note: billings.note,
                        createdAt: billings.createdAt,
                      })
                      .from(billings)
                      .where(inArray(billings.projectId, orgProjectIds)),
                    getListingsForProjects(orgProjectIds, "nearn", orgId, db),
                    getListingsForProjects(orgProjectIds, "internal", orgId, db),
                  ])
                : [
                    [] as { projectId: string; tokenId: string; amount: string }[],
                    [] as (typeof billings.$inferSelect)[],
                    new Map<
                      string,
                      Awaited<ReturnType<typeof getListingsForProjects>> extends Map<
                        string,
                        infer V
                      >
                        ? V
                        : never
                    >(),
                    new Map<
                      string,
                      Awaited<ReturnType<typeof getListingsForProjects>> extends Map<
                        string,
                        infer V
                      >
                        ? V
                        : never
                    >(),
                  ];
            const bills = await Promise.all(
              billingRows.map((b) => enrichWithChainStatus(b, orgId)),
            );

            const rollupArgs = {
              projectIds: orgProjectIds,
              budgetRows,
              billingRows: bills.map((b) => ({
                projectId: b.projectId,
                tokenId: b.tokenId,
                amount: b.amount,
                status: b.status,
              })),
              nearnListings,
              internalListings,
              network: networkOf(orgId),
            };
            const tokenIds = tokenIdsForRollup(rollupArgs);
            const balances = tokenIds.length > 0 ? await getTreasuryBalances(orgId, tokenIds) : {};
            return { rollups: assembleAgencyRollups({ ...rollupArgs, balances }) };
          }),

        getPublicSummary: builder.treasury.getPublicSummary.handler(async ({ context }) => {
          const orgAccountId = await getDaoAccountId(context);
          try {
            const [balances, tokenIds] = await Promise.all([
              getTreasuryBalances(orgAccountId, [NATIVE_TOKEN_ID]),
              getDaoTokenIds(orgAccountId),
            ]);
            return summarizeTreasury(balances, tokenIds);
          } catch {
            return summarizeTreasury({}, []);
          }
        }),
      },

      me: {
        assignedProjects: builder.me.assignedProjects
          .use(gates.org)
          .handler(async ({ context }) => {
            const orgId = await getDaoAccountId(context);
            const nearAccountId = context.near?.primaryAccountId as string | null | undefined;
            if (!nearAccountId) return { data: [] };

            const myContributor = await db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.nearAccountId, nearAccountId))
              .limit(1);
            const me = myContributor[0];
            if (!me) return { data: [] };

            const orgProjectsById = await fetchOrgProjectsById(orgId);
            const assignments = await db
              .select({
                projectId: projectContributors.projectId,
                role: projectContributors.role,
              })
              .from(projectContributors)
              .where(eq(projectContributors.contributorId, me.id));

            const linkByProjectId = await getListingsForProjects(
              assignments.map((a) => a.projectId),
              "nearn",
              orgId,
              db,
              { skipRefresh: true },
            );

            const data = assignments
              .map((a) => {
                const p = orgProjectsById.get(a.projectId);
                if (!p) return null;
                return {
                  ...toContractProject(
                    p,
                    linkByProjectId.get(a.projectId)?.externalId ?? null,
                    orgId,
                  ),
                  role: a.role,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null)
              .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            return { data };
          }),

        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const role = context.organization?.member?.role as string | null | undefined;
          return {
            orgRole: role,
          };
        }),
      },

      team: {
        list: builder.team.list.handler(async ({ context }) => {
          const orgAccountId = await getDaoAccountId(context);
          try {
            const roles = await getRoles(orgAccountId);
            return { roles };
          } catch {
            return { roles: [] };
          }
        }),

        getPublicSummary: builder.team.getPublicSummary.handler(async ({ context }) => {
          const orgAccountId = await getDaoAccountId(context);
          try {
            const roles = await getRoles(orgAccountId);
            return summarizeTeam(roles);
          } catch {
            return summarizeTeam([]);
          }
        }),
      },

      agencyConfig: {
        getPublic: builder.agencyConfig.getPublic.handler(async ({ context }) => {
          const network = getNetwork(context.reqHeaders);
          const settingsKey = getDaoAccountId(context);
          const resolved = await getResolvedPublicSettings(db, network, settingsKey);
          return {
            ...resolved,
            network,
            networkPinned: pinnedNetwork() !== null,
          };
        }),

        get: builder.agencyConfig.get.use(gates.admin).handler(async ({ context }) => {
          const network = getNetwork(context.reqHeaders);
          const settingsKey = getDaoAccountId(context);
          const orgAccountId = await getDaoAccountId(context);
          const row = await getSettingsRow(db, settingsKey);
          const base = defaultPublicSettings(network);
          return {
            orgAccountId,
            network,
            editable: {
              daoAccountId: row?.daoAccountId ?? null,
              nearnAccountId: row?.nearnAccountId ?? base.nearnAccountId,
              websiteUrl: row?.websiteUrl ?? base.websiteUrl,
              docsUrl: row?.docsUrl ?? base.docsUrl,
              description: row?.description ?? base.description,
              contactEmail: row?.contactEmail ?? base.contactEmail,
            },
            readOnly: {
              name: base.name,
              headline: base.headline,
              tagline: base.tagline,
            },
            audit: row
              ? {
                  createdBy: row.createdBy,
                  createdAt: row.createdAt.toISOString(),
                  updatedBy: row.updatedBy,
                  updatedAt: row.updatedAt.toISOString(),
                }
              : null,
          };
        }),

        update: builder.agencyConfig.update.use(gates.admin).handler(async ({ context, input }) => {
          const settingsKey = getDaoAccountId(context);
          const actorId = context.near?.primaryAccountId ?? context.userId ?? "unknown";
          await upsertSettings(
            db,
            settingsKey,
            {
              daoAccountId: input.daoAccountId ?? null,
              nearnAccountId: input.nearnAccountId,
              websiteUrl: input.websiteUrl,
              docsUrl: input.docsUrl,
              description: input.description,
              contactEmail: input.contactEmail,
            },
            actorId,
          );
          return { ok: true as const };
        }),
      },

      platform: {
        listOrgs: builder.platform.listOrgs.use(gates.superAdmin).handler(async ({ context }) => {
          const orgs = await plugins.auth(context).listAllOrganizations();
          return orgs.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            metadata: o.metadata,
            createdAt:
              o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
          }));
        }),

        createOrg: builder.platform.createOrg
          .use(gates.superAdmin)
          .handler(async ({ context, input }) => {
            const metadata: Record<string, unknown> = {};
            if (input.daoAccountId) metadata.daoAccountId = input.daoAccountId;
            const org = await plugins.auth(context).createOrganization({
              name: input.name,
              slug: input.slug,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            });
            await plugins.auth(context).inviteMember({
              email: input.adminEmail,
              role: "admin",
              organizationId: org.id,
            });
            const settingsKey = input.daoAccountId;
            await upsertSettings(
              db,
              settingsKey,
              {
                daoAccountId: input.daoAccountId,
                nearnAccountId: null,
                websiteUrl: null,
                docsUrl: null,
                description: null,
                contactEmail: null,
              },
              context.near?.primaryAccountId ?? settingsKey,
            );
            return { id: org.id, name: org.name, slug: org.slug };
          }),

        updateOrg: builder.platform.updateOrg.use(gates.superAdmin).handler(async ({ context, input }) => {
          const allOrgs = await plugins.auth(context).listAllOrganizations();
          const existing = allOrgs.find((o) => o.id === input.orgId);
          if (!existing) throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
          const newMetadata = { ...(existing.metadata ?? {}) };
          if (input.daoAccountId !== undefined) newMetadata.daoAccountId = input.daoAccountId;
          const updated = await plugins.auth(context).updateOrganization({
            id: input.orgId,
            name: input.name,
            metadata: newMetadata,
          });
          const daoAccountId =
            (newMetadata.daoAccountId as string | undefined) ?? existing.metadata?.daoAccountId as string | undefined;
          if (daoAccountId) {
            const existingSettings = await getSettingsRow(db, daoAccountId);
            await upsertSettings(
              db,
              daoAccountId,
              {
                daoAccountId,
                nearnAccountId: existingSettings?.nearnAccountId ?? null,
                websiteUrl: existingSettings?.websiteUrl ?? null,
                docsUrl: existingSettings?.docsUrl ?? null,
                description: existingSettings?.description ?? null,
                contactEmail: existingSettings?.contactEmail ?? null,
              },
              updated.slug,
            );
          }
          return { id: updated.id, name: updated.name, slug: updated.slug };
        }),

        listOrgMembers: builder.platform.listOrgMembers
          .use(gates.superAdmin)
          .handler(async ({ context, input }) => {
            const members = await plugins.auth(context).listMembers({ organizationId: input.orgId });
            return members.map((m) => ({
              id: m.id,
              userId: m.userId,
              nearAccountId: m.user?.name ?? null,
              role: m.role,
            }));
          }),

        addOrgMember: builder.platform.addOrgMember
          .use(gates.superAdmin)
          .handler(async ({ context, input }) => {
            await plugins.auth(context).inviteMember({
              email: input.email,
              role: input.role as "admin" | "member",
              organizationId: input.orgId,
            });
            return { ok: true as const };
          }),

        updateOrgMember: builder.platform.updateOrgMember
          .use(gates.superAdmin)
          .handler(async ({ context, input }) => {
            await plugins.auth(context).updateMemberRole({
              id: input.memberId,
              organizationId: input.orgId,
              role: input.role as "admin" | "member",
            });
            return { ok: true as const };
          }),

        removeOrgMember: builder.platform.removeOrgMember
          .use(gates.superAdmin)
          .handler(async ({ context, input }) => {
            await plugins.auth(context).removeMember({
              id: input.memberId,
              organizationId: input.orgId,
            });
            return { ok: true as const };
          }),

        deleteOrg: builder.platform.deleteOrg.use(gates.superAdmin).handler(async ({ context, input }) => {
          await plugins.auth(context).deleteOrganization({ id: input.orgId });
          return { ok: true as const };
        }),

        listProjects: builder.platform.listProjects.use(gates.superAdmin).handler(async ({ context }) => {
          const orgs = await plugins.auth(context).listAllOrganizations();
          const orgsWithProjects = await Promise.all(
            orgs.map(async (org) => {
              const daoAccountId = String(
                (org.metadata as { daoAccountId?: string })?.daoAccountId ?? "",
              );
              let projects: ReturnType<typeof toPublicProject>[] = [];
              try {
                projects = await fetchPlatformOrgProjects(org);
              } catch {
                projects = [];
              }
              return {
                id: org.id,
                name: org.name,
                slug: org.slug,
                daoAccountId: daoAccountId || null,
                projects,
              };
            }),
          );
          return { orgs: orgsWithProjects };
        }),
      },

      members: {
        list: builder.members.list.use(gates.admin).handler(async ({ context }) => {
          const orgId = context.organizationId as string | null;
          if (!orgId) throw new ORPCError("FORBIDDEN", { message: "Active organization required" });
          const authClient = plugins.auth(context);
          const members = await authClient.listMembers({ organizationId: orgId });
          return members.map((m) => ({
            id: m.id,
            userId: m.userId,
            nearAccountId: m.user?.name ?? null,
            displayName: m.user?.name ?? null,
            role: m.role,
          }));
        }),

        invite: builder.members.invite
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            const orgId = context.organizationId as string | null;
            if (!orgId)
              throw new ORPCError("FORBIDDEN", { message: "Active organization required" });
            await plugins.auth(context).inviteMember({
              email: input.email,
              role: input.role as "admin" | "member",
              organizationId: orgId,
            });
            return { ok: true as const };
          }),

        updateRole: builder.members.updateRole
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            const orgId = context.organizationId as string | null;
            if (!orgId)
              throw new ORPCError("FORBIDDEN", { message: "Active organization required" });
            await plugins.auth(context).updateMemberRole({
              id: input.memberId,
              organizationId: orgId,
              role: input.role as "admin" | "member",
            });
            return { ok: true as const };
          }),

        remove: builder.members.remove.use(gates.admin).handler(async ({ context, input }) => {
          const orgId = context.organizationId as string | null;
          if (!orgId) throw new ORPCError("FORBIDDEN", { message: "Active organization required" });
          await plugins.auth(context).removeMember({
            id: input.memberId,
            organizationId: orgId,
          });
          return { ok: true as const };
        }),
      },
    };
  },
});
