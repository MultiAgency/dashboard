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
import { defaultOrgAccount, pinnedNetwork } from "./lib/default-org-account";
import { getNetwork } from "./lib/network";
import type { PluginsClient } from "./lib/plugins-types.gen";
import {
  defaultAdminRoleName,
  defaultApproverRoleName,
  defaultContactEmail,
  defaultNearnAccountId,
  defaultPublicSettings,
  defaultRequestorRoleName,
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
  userInRole,
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

export interface AuthContext {
  userId: string;
  user: {
    id: string;
    role?: string;
    email?: string;
    name?: string;
  };
  nearAccountId: string;
  reqHeaders?: Headers;
}

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

    const hostUrl = process.env.HOST_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;

    const getCookie = (reqHeaders: unknown): string | undefined => {
      if (!reqHeaders) return undefined;
      if (reqHeaders instanceof Headers) return reqHeaders.get("cookie") ?? undefined;
      const obj = reqHeaders as Record<string, string>;
      return obj.cookie ?? obj.Cookie;
    };

    const resolveNearAccountId = async (reqHeaders: unknown): Promise<string | undefined> => {
      const cookie = getCookie(reqHeaders);
      if (!cookie) return undefined;
      try {
        const res = await fetch(`${hostUrl}/api/auth/near/list-accounts`, {
          headers: { cookie },
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as {
          accounts?: Array<{ accountId: string; isPrimary?: boolean }>;
        };
        const accounts = data.accounts ?? [];
        const primary = accounts.find((a) => a.isPrimary) ?? accounts[0];
        return primary?.accountId;
      } catch (err) {
        console.warn("[API] Failed to resolve nearAccountId:", (err as Error).message);
        return undefined;
      }
    };

    // Settings is keyed by orgAccountId, so orgAccountId resolves from env BEFORE any DB lookup.
    // Async signature preserved as forward-compat: multi-tenant resolution will read session/DB.
    const getOrgAccountId = (reqHeaders: Headers | undefined): Promise<string> =>
      Promise.resolve(defaultOrgAccount(getNetwork(reqHeaders)));

    const requireSession = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
      }
      const nearAccountId = await resolveNearAccountId(context.reqHeaders);
      if (!nearAccountId) {
        throw new ORPCError("FORBIDDEN", {
          message: "NEAR account required for this action",
        });
      }
      return next({
        context: {
          userId: context.userId,
          user: context.user,
          nearAccountId,
          reqHeaders: context.reqHeaders,
        } satisfies AuthContext,
      });
    });

    type RoleKey = "admin" | "approver" | "requestor";
    const roleNameFor = (key: RoleKey): string => {
      if (key === "admin") return defaultAdminRoleName();
      if (key === "approver") return defaultApproverRoleName();
      return defaultRequestorRoleName();
    };

    const requireRoles = (roles: RoleKey[]) =>
      builder.middleware(async ({ context, next }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
        }
        const nearAccountId = await resolveNearAccountId(context.reqHeaders);
        if (!nearAccountId) {
          throw new ORPCError("FORBIDDEN", {
            message: "NEAR account required for this action",
          });
        }
        const orgAccountId = await getOrgAccountId(context.reqHeaders);
        const roleNames = roles.map(roleNameFor);
        const checks = await Promise.all(
          roleNames.map((name) => userInRole(orgAccountId, nearAccountId, name)),
        );
        if (!checks.some(Boolean)) {
          throw new ORPCError("FORBIDDEN", {
            message: `Requires ${roleNames.join(" or ")} role on ${orgAccountId} (your view network's DAO); your account ${nearAccountId} has none.`,
          });
        }
        return next({
          context: {
            userId: context.userId,
            user: context.user,
            nearAccountId,
            reqHeaders: context.reqHeaders,
          } as AuthContext,
        });
      });

    const gates = {
      admin: requireRoles(["admin"]),
      approver: requireRoles(["approver"]),
      requestor: requireRoles(["requestor"]),
      operator: requireRoles(["admin", "approver"]),
      member: requireRoles(["admin", "approver", "requestor"]),
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

    const computeBudget = async (projectId: string, reqHeaders: Headers | undefined) => {
      const orgId = await getOrgAccountId(reqHeaders);
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

    // Proxy as orgAccountId: upstream's canEditProject is per-ownerId; per-op audit in budgets/billings actorAccountId.
    const proxyCtx = (orgAccountId: string) => ({
      userId: orgAccountId,
      walletAddress: orgAccountId,
      user: { id: orgAccountId },
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
      status: p.status,
      visibility: p.visibility,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    });

    // Short TTL caches the DAO project list across handler-burst calls; writes invalidate.
    const DAO_PROJECTS_TTL_MS = 5_000;
    const daoProjectsCache = new Map<string, { projects: UpstreamProject[]; expiresAt: number }>();
    const invalidateOrgProjects = (orgAccountId: string): void => {
      daoProjectsCache.delete(orgAccountId);
    };

    // DAO ctx admits private DAO projects via upstream's ownerId===userId branch.
    const fetchOrgProjects = async (orgAccountId: string): Promise<UpstreamProject[]> => {
      const cached = daoProjectsCache.get(orgAccountId);
      if (cached && cached.expiresAt > Date.now()) return cached.projects;
      const ctx = proxyCtx(orgAccountId);
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
    ): Promise<Map<string, UpstreamProject>> => {
      const ps = await fetchOrgProjects(orgAccountId);
      return new Map(ps.map((p) => [p.id, p]));
    };

    const requireProjectInOrg = async (
      projectId: string,
      orgAccountId: string,
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
        const result = await plugins.projects(proxyCtx(orgAccountId)).getProject({ id: projectId });
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

        adminList: builder.applications.adminList.use(gates.operator).handler(async ({ input }) => {
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

        adminUpdate: builder.applications.adminUpdate
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            const reviewed = input.status !== "new";
            const result = await db
              .update(applications)
              .set({
                status: input.status,
                reviewedBy: reviewed ? context.nearAccountId : null,
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
          list: builder.agency.projects.list.handler(async ({ context }) => {
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
            if (!plugins.projects) return { data: [] };

            const upstream: UpstreamProject[] = [];
            let cursor: string | undefined;
            do {
              const result = await plugins.projects(proxyCtx(orgAccountId)).listProjects({
                organizationId: orgAccountId,
                visibility: "public",
                status: "active",
                limit: 100,
                cursor,
              });
              upstream.push(...result.data);
              cursor = result.meta.nextCursor ?? undefined;
            } while (cursor);
            const projectIds = upstream.map((p) => p.id);
            const linkByProjectId = isNearnAvailable(orgAccountId)
              ? await getListingsForProjects(projectIds, "nearn", orgAccountId, db)
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

          adminGet: builder.agency.projects.adminGet
            .use(requireSession)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              const upstreamMatch = (await fetchOrgProjects(orgAccountId)).find(
                (p) => p.slug === input.slug,
              );
              if (!upstreamMatch) {
                throw new ORPCError("NOT_FOUND", { message: "Project not found" });
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

              const [admin, approver, requestor] = await Promise.all([
                userInRole(orgAccountId, context.nearAccountId!, defaultAdminRoleName()),
                userInRole(orgAccountId, context.nearAccountId!, defaultApproverRoleName()),
                userInRole(orgAccountId, context.nearAccountId!, defaultRequestorRoleName()),
              ]);
              if (!admin && !approver && !requestor) {
                const isAssigned = contributorRows.some(
                  (c) => c.nearAccountId && c.nearAccountId === context.nearAccountId,
                );
                if (!isAssigned) {
                  throw new ORPCError("FORBIDDEN", {
                    message: `Project access requires ${defaultAdminRoleName()}/${defaultApproverRoleName()}/${defaultRequestorRoleName()} role or contributor assignment`,
                  });
                }
              }

              return {
                project: toContractProject(upstreamMatch, link?.externalId ?? null, orgAccountId),
                contributors: contributorRows,
              };
            }),

          getBudget: builder.agency.projects.getBudget
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              await requireProjectInOrg(input.projectId, orgAccountId);
              return { budgets: await computeBudget(input.projectId, context.reqHeaders) };
            }),

          adminList: builder.agency.projects.adminList
            .use(gates.member)
            .handler(async ({ context }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              const upstream = await fetchOrgProjects(orgAccountId);
              const projectIds = upstream.map((p) => p.id);
              const linkByProjectId = await getListingsForProjects(
                projectIds,
                "nearn",
                orgAccountId,
                db,
                {
                  skipRefresh: true,
                },
              );
              const data = upstream
                .map((p) =>
                  toContractProject(p, linkByProjectId.get(p.id)?.externalId ?? null, orgAccountId),
                )
                .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
              return { data };
            }),

          adminCreate: builder.agency.projects.adminCreate
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              const ctx = proxyCtx(orgAccountId);
              const created = await plugins.projects(ctx).createProject({
                kind: "project",
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

          adminUpdate: builder.agency.projects.adminUpdate
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              const ctx = proxyCtx(orgAccountId);
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

          adminDelete: builder.agency.projects.adminDelete
            .use(gates.admin)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
              await requireProjectInOrg(input.id, orgAccountId);

              // Cascade local rows first (atomic via the service's transaction), then upstream
              // delete. Re-running on upstream failure is safe: the cascade becomes a no-op.
              // Partial-failure cross-system state (agency empty, upstream still has project) is
              // converged by the re-run.
              await deleteProjectCascade(db, input.id);
              await plugins.projects(proxyCtx(orgAccountId)).deleteProject({ id: input.id });
              invalidateOrgProjects(orgAccountId);
              return { deleted: true as const };
            }),
        },

        listings: {
          adminGet: builder.agency.listings.adminGet
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
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

          adminCreate: builder.agency.listings.adminCreate
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
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

          adminUpdate: builder.agency.listings.adminUpdate
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
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

          adminDelete: builder.agency.listings.adminDelete
            .use(gates.operator)
            .handler(async ({ context, input }) => {
              const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
        adminList: builder.contributors.adminList.use(gates.operator).handler(async () => {
          const rows = await db.select().from(contributors).orderBy(desc(contributors.updatedAt));
          return { data: rows };
        }),

        adminCreate: builder.contributors.adminCreate
          .use(gates.admin)
          .handler(async ({ input }) => {
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

        adminUpdate: builder.contributors.adminUpdate
          .use(gates.admin)
          .handler(async ({ input }) => {
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
        adminList: builder.assignments.adminList
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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

        adminCreate: builder.assignments.adminCreate
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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

        adminDelete: builder.assignments.adminDelete
          .use(gates.operator)
          .handler(async ({ input }) => {
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
        adminList: builder.budgets.adminList
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            // Validate projectId is in-DAO upfront — explicit 404 over silent empty.
            if (input.projectId) await requireProjectInOrg(input.projectId, orgId);
            const projectIds = input.projectId
              ? [input.projectId]
              : (await fetchOrgProjects(orgId)).map((p) => p.id);
            return listBudgets(db, {
              projectIds,
              tokenId: input.tokenId,
              cursor: input.cursor,
              limit: input.limit,
            });
          }),

        adminCreate: builder.budgets.adminCreate
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            await requireProjectInOrg(input.projectId, orgId);
            const budget = await createBudget(db, {
              projectId: input.projectId,
              tokenId: input.tokenId,
              amount: input.amount,
              note: input.note ?? null,
              actorAccountId: context.nearAccountId!,
            });
            return { budget };
          }),

        adminDeallocate: builder.budgets.adminDeallocate
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            await requireProjectInOrg(input.projectId, orgId);
            try {
              const budget = await deallocateBudget(db, {
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: context.nearAccountId!,
              });
              return { budget };
            } catch (err) {
              if (err instanceof BudgetInsufficientError) {
                throw new ORPCError("BAD_REQUEST", { message: err.message });
              }
              throw err;
            }
          }),

        adminTransfer: builder.budgets.adminTransfer
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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
                actorAccountId: context.nearAccountId!,
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
        adminList: builder.billings.adminList
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            if (input.projectId) await requireProjectInOrg(input.projectId, orgId);
            const projectIds = input.projectId
              ? [input.projectId]
              : (await fetchOrgProjects(orgId)).map((p) => p.id);
            const rows = await db
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

        adminCreate: builder.billings.adminCreate
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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

        adminDelete: builder.billings.adminDelete
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
          try {
            const { transfers, lastProposalId, nextFromIndex } = await fetchTransferProposals(
              db,
              orgAccountId,
              input.fromIndex,
              input.limit,
            );
            return {
              data: transfers.map(toProposalPublicItem),
              lastProposalId,
              nextFromIndex,
            };
          } catch {
            // RPC failures degrade to empty for public visitors; admins see errors.
            return { data: [], lastProposalId: 0, nextFromIndex: null };
          }
        }),

        adminList: builder.proposals.adminList
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            const { transfers, lastProposalId, nextFromIndex } = await fetchTransferProposals(
              db,
              orgId,
              input.fromIndex,
              input.limit,
            );

            const proposalIdStrs = transfers.map((p) => String(p.id));
            const orgProjectsById = await fetchOrgProjectsById(orgId);
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
          }),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) => {
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          .use(gates.operator)
          .handler(async ({ context }) => {
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
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

        getRollups: builder.treasury.getRollups.use(gates.operator).handler(async ({ context }) => {
          const orgId = await getOrgAccountId(context.reqHeaders);
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
                    Awaited<ReturnType<typeof getListingsForProjects>> extends Map<string, infer V>
                      ? V
                      : never
                  >(),
                  new Map<
                    string,
                    Awaited<ReturnType<typeof getListingsForProjects>> extends Map<string, infer V>
                      ? V
                      : never
                  >(),
                ];
          const bills = await Promise.all(billingRows.map((b) => enrichWithChainStatus(b, orgId)));

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
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
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
          .use(requireSession)
          .handler(async ({ context }) => {
            const orgId = await getOrgAccountId(context.reqHeaders);
            const myContributor = await db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.nearAccountId, context.nearAccountId!))
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

        roles: builder.me.roles.use(requireSession).handler(async ({ context }) => {
          const fallback = { isAdmin: false, isApprover: false, isRequestor: false };
          try {
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
            const [isAdmin, isApprover, isRequestor] = await Promise.all([
              userInRole(orgAccountId, context.nearAccountId!, defaultAdminRoleName()),
              userInRole(orgAccountId, context.nearAccountId!, defaultApproverRoleName()),
              userInRole(orgAccountId, context.nearAccountId!, defaultRequestorRoleName()),
            ]);
            return { isAdmin, isApprover, isRequestor };
          } catch (err) {
            console.warn(
              "[API] me.roles failed; returning non-admin fallback:",
              (err as Error).message,
            );
            return fallback;
          }
        }),
      },

      team: {
        list: builder.team.list.handler(async ({ context }) => {
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
          try {
            const roles = await getRoles(orgAccountId);
            return { roles };
          } catch {
            return { roles: [] };
          }
        }),

        getPublicSummary: builder.team.getPublicSummary.handler(async ({ context }) => {
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
          try {
            const roles = await getRoles(orgAccountId);
            return summarizeTeam(roles);
          } catch {
            return summarizeTeam([]);
          }
        }),
      },

      settings: {
        getPublic: builder.settings.getPublic.handler(async ({ context }) => {
          const network = getNetwork(context.reqHeaders);
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
          const resolved = await getResolvedPublicSettings(db, network, orgAccountId);
          return {
            ...resolved,
            network,
            networkPinned: pinnedNetwork() !== null,
          };
        }),

        adminGet: builder.settings.adminGet.use(gates.admin).handler(async ({ context }) => {
          const network = getNetwork(context.reqHeaders);
          const orgAccountId = await getOrgAccountId(context.reqHeaders);
          const row = await getSettingsRow(db, orgAccountId);
          const base = defaultPublicSettings(network);
          return {
            orgAccountId,
            network,
            editable: {
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
              adminRoleName: defaultAdminRoleName(),
              approverRoleName: defaultApproverRoleName(),
              requestorRoleName: defaultRequestorRoleName(),
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

        adminUpdate: builder.settings.adminUpdate
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            // orgAccountId is the row's immutable PK identity, resolved from request context (env →
            // hardcoded). Changing the active DAO is an env-level concern, not an in-app save —
            // see settings-admin.ts. The gate already verified caller is admin on this orgAccountId.
            const orgAccountId = await getOrgAccountId(context.reqHeaders);
            await upsertSettings(db, orgAccountId, input, context.nearAccountId);
            return { ok: true as const };
          }),
      },
    };
  },
});
