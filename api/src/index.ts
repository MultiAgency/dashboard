import { and, desc, eq, inArray } from "drizzle-orm";
import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { createDatabase, type Database } from "./db";
import { cursorOf, cursorWhere } from "./db/cursor";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import {
  agencySettings,
  allocations,
  applications,
  billings,
  contributors,
  projectContributors,
  projects,
} from "./db/schema";
import type { PluginsClient } from "./plugins-client.gen";
import { getNearnListing, listNearnBountiesForSponsor } from "./services/nearn";
import {
  type DaoProposal,
  getLastProposalId,
  getProposal,
  getProposals,
  getRoles,
  getTreasuryBalances,
  userInRole,
} from "./services/sputnik";
import { KNOWN_TOKENS } from "./services/tokens";

const DEFAULT_DAO_ACCOUNT = "multiagency.sputnik-dao.near";
const SETTINGS_ID = "default";
const DEFAULT_ADMIN_ROLE = "Admin";

export async function claimDaoConfig(args: {
  db: Database;
  nearAccountId: string;
  input: { daoAccountId: string; adminRoleName?: string };
  isAdmin: (dao: string, account: string, role: string) => Promise<boolean>;
}): Promise<{ ok: true }> {
  const { db, nearAccountId, input, isAdmin } = args;
  const currentRows = await db
    .select()
    .from(agencySettings)
    .where(eq(agencySettings.id, SETTINGS_ID))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Agency settings not initialized",
    });
  }
  if (current.daoAccountId !== DEFAULT_DAO_ACCOUNT) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Agency is already configured.",
    });
  }
  const effectiveAdminRole = input.adminRoleName ?? DEFAULT_ADMIN_ROLE;
  const adminOnDestination = await isAdmin(input.daoAccountId, nearAccountId, effectiveAdminRole);
  if (!adminOnDestination) {
    throw new ORPCError("FORBIDDEN", {
      message: `Not a ${effectiveAdminRole} on ${input.daoAccountId}.`,
    });
  }
  const updates: Record<string, unknown> = {
    daoAccountId: input.daoAccountId,
    updatedAt: new Date(),
  };
  if (input.adminRoleName && input.adminRoleName !== DEFAULT_ADMIN_ROLE) {
    updates.adminRoleName = input.adminRoleName;
  }
  await db.update(agencySettings).set(updates).where(eq(agencySettings.id, SETTINGS_ID));
  return { ok: true };
}

export interface AuthContext {
  userId: string;
  user: {
    id: string;
    role?: string;
    email?: string;
    name?: string;
  };
  nearAccountId?: string;
  organizationId?: string;
  organizationRole?: string;
  reqHeaders?: Headers;
}

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("file:./api.db"),
    API_DATABASE_AUTH_TOKEN: z.string().optional(),
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
    nearAccountId: z.string().optional(),
    nearAccounts: z
      .array(
        z.object({
          accountId: z.string(),
          network: z.string(),
          isPrimary: z.boolean(),
        }),
      )
      .optional(),
    organizationId: z.string().optional(),
    organizationRole: z.string().optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
  }),

  contract,

  initialize: (config, plugins) =>
    Effect.gen(function* () {
      const db = yield* Effect.promise(() => createDatabase(config.secrets.API_DATABASE_URL));
      const migrations = yield* Effect.promise(() => loadMigrations());
      yield* Effect.promise(() => migrate(db, migrations));
      yield* Effect.promise(() =>
        db
          .insert(agencySettings)
          .values({
            id: SETTINGS_ID,
            daoAccountId: process.env.AGENCY_DAO_ACCOUNT ?? DEFAULT_DAO_ACCOUNT,
          })
          .onConflictDoNothing(),
      );
      console.log("[API] Services Initialized");
      console.log("[API] Plugins available:", Object.keys(plugins).join(", ") || "none");
      return { db, plugins };
    }),

  shutdown: () => Effect.log("[API] Shutdown"),

  createRouter: (services, builder) => {
    const { db } = services;

    // Upstream host drops nearAccountId from plugin context; fetch via better-near-auth's list-accounts.
    const nearAccountIdCache = new Map<string, { accountId: string; expiresAt: number }>();
    const NEAR_ACCOUNT_TTL_MS = 60_000;

    if (process.env.NODE_ENV === "production" && !process.env.HOST_URL) {
      throw new Error("HOST_URL must be set in production");
    }
    const hostUrl = process.env.HOST_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;

    const resolveNearAccountId = async (context: {
      nearAccountId?: string;
      userId?: string;
      reqHeaders?: Headers;
    }): Promise<string | undefined> => {
      if (context.nearAccountId) return context.nearAccountId;
      if (!context.userId || !context.reqHeaders) return undefined;

      const cached = nearAccountIdCache.get(context.userId);
      if (cached && cached.expiresAt > Date.now()) return cached.accountId;

      const cookie = context.reqHeaders.get("cookie") ?? "";
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
        if (!primary?.accountId) return undefined;

        nearAccountIdCache.set(context.userId, {
          accountId: primary.accountId,
          expiresAt: Date.now() + NEAR_ACCOUNT_TTL_MS,
        });
        return primary.accountId;
      } catch (err) {
        console.warn("[API] Failed to resolve nearAccountId:", (err as Error).message);
        return undefined;
      }
    };

    const requireSession = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
      }
      const nearAccountId = await resolveNearAccountId(context);
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
          organizationId: context.organizationId,
          organizationRole: context.organizationRole,
          reqHeaders: context.reqHeaders,
        } satisfies AuthContext,
      });
    });

    type RoleKey = "admin" | "approver" | "requestor";
    const ROLE_DEFAULTS: Record<RoleKey, string> = {
      admin: "Admin",
      approver: "Approver",
      requestor: "Requestor",
    };
    const resolveRoleName = (
      key: RoleKey,
      settings: typeof agencySettings.$inferSelect,
    ): string => {
      const override =
        key === "admin"
          ? settings.adminRoleName
          : key === "approver"
            ? settings.approverRoleName
            : settings.requestorRoleName;
      return override?.trim() || ROLE_DEFAULTS[key];
    };

    const requireRoles = (roles: RoleKey[]) =>
      builder.middleware(async ({ context, next }) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
        }
        const nearAccountId = await resolveNearAccountId(context);
        if (!nearAccountId) {
          throw new ORPCError("FORBIDDEN", {
            message: "NEAR account required for this action",
          });
        }
        const settingsRows = await db
          .select()
          .from(agencySettings)
          .where(eq(agencySettings.id, SETTINGS_ID))
          .limit(1);
        const settings = settingsRows[0];
        if (!settings) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Agency settings not initialized",
          });
        }
        const roleNames = roles.map((r) => resolveRoleName(r, settings));
        const checks = await Promise.all(
          roleNames.map((name) => userInRole(settings.daoAccountId, nearAccountId, name)),
        );
        if (!checks.some(Boolean)) {
          throw new ORPCError("FORBIDDEN", {
            message: `Requires ${roleNames.join(" or ")} role on the agency DAO`,
          });
        }
        return next({
          context: {
            userId: context.userId,
            user: context.user,
            nearAccountId,
            organizationId: context.organizationId,
            organizationRole: context.organizationRole,
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

    const getOrgId = async (): Promise<string> => {
      const rows = await db
        .select({ daoAccountId: agencySettings.daoAccountId })
        .from(agencySettings)
        .where(eq(agencySettings.id, SETTINGS_ID))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Agency settings not initialized",
        });
      }
      return row.daoAccountId;
    };

    const PROPOSAL_TERMINAL_FAIL = new Set(["Rejected", "Removed", "Expired", "Moved", "Failed"]);
    const enrichWithChainStatus = async (b: typeof billings.$inferSelect, daoAccountId: string) => {
      const proposalId = Number.parseInt(b.proposalId, 10);
      if (Number.isNaN(proposalId)) return { ...b, status: "InProgress" as const };
      const proposal = await getProposal(daoAccountId, proposalId);
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

    const computeBudget = async (projectId: string) => {
      const orgId = await getOrgId();
      const [allocs, billsRaw] = await Promise.all([
        db
          .select({ tokenId: allocations.tokenId, amount: allocations.amount })
          .from(allocations)
          .where(eq(allocations.projectId, projectId)),
        db.select().from(billings).where(eq(billings.projectId, projectId)),
      ]);
      const bills = await Promise.all(billsRaw.map((b) => enrichWithChainStatus(b, orgId)));
      const tokenIds = Array.from(
        new Set([...allocs.map((a) => a.tokenId), ...bills.map((b) => b.tokenId)]),
      ).sort();
      const sumBig = (rows: { amount: string }[]) =>
        rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);
      return tokenIds.map((tokenId) => {
        const tokenAllocs = allocs.filter((a) => a.tokenId === tokenId);
        const liveBills = bills.filter(
          (b) => b.tokenId === tokenId && !PROPOSAL_TERMINAL_FAIL.has(b.status),
        );
        const budget = sumBig(tokenAllocs);
        const allocated = sumBig(liveBills);
        const paid = sumBig(liveBills.filter((b) => b.status === "Approved"));
        return {
          tokenId,
          budget: budget.toString(),
          allocated: allocated.toString(),
          paid: paid.toString(),
          remaining: (budget - allocated).toString(),
        };
      });
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
            const result = await db
              .update(applications)
              .set({
                status: input.status,
                reviewedBy: context.nearAccountId ?? null,
                reviewedAt: new Date(),
              })
              .where(eq(applications.id, input.id))
              .returning();
            const row = result[0];
            if (!row) throw new ORPCError("NOT_FOUND", { message: "Application not found" });
            return { application: row };
          }),
      },

      projects: {
        list: builder.projects.list.handler(async () => {
          const orgId = await getOrgId();
          const rows = await db
            .select()
            .from(projects)
            .where(
              and(
                eq(projects.organizationId, orgId),
                eq(projects.visibility, "public"),
                eq(projects.status, "active"),
              ),
            )
            .orderBy(desc(projects.updatedAt));
          const enriched = await Promise.all(
            rows.map(async (p) => {
              if (!p.nearnListingId) return { ...p, nearnListing: null };
              try {
                const listing = await getNearnListing(p.nearnListingId);
                return { ...p, nearnListing: listing };
              } catch (err) {
                console.warn(
                  `[API] NEARN listing fetch failed for slug=${p.nearnListingId}:`,
                  (err as Error).message,
                );
                return { ...p, nearnListing: null };
              }
            }),
          );
          return { data: enriched };
        }),

        adminGet: builder.projects.adminGet
          .use(requireSession)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgId();
            const projectRows = await db
              .select()
              .from(projects)
              .where(and(eq(projects.organizationId, orgId), eq(projects.slug, input.slug)))
              .limit(1);
            const projectRow = projectRows[0];
            if (!projectRow) {
              throw new ORPCError("NOT_FOUND", { message: "Project not found" });
            }
            const contributorRows = await db
              .select({
                id: contributors.id,
                name: contributors.name,
                nearAccountId: contributors.nearAccountId,
                role: projectContributors.role,
              })
              .from(projectContributors)
              .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
              .where(eq(projectContributors.projectId, projectRow.id))
              .orderBy(desc(projectContributors.createdAt));

            const settingsRows = await db
              .select()
              .from(agencySettings)
              .where(eq(agencySettings.id, SETTINGS_ID))
              .limit(1);
            const settings = settingsRows[0];
            if (!settings) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Agency settings not initialized",
              });
            }
            const adminRole = resolveRoleName("admin", settings);
            const approverRole = resolveRoleName("approver", settings);
            const requestorRole = resolveRoleName("requestor", settings);
            const [admin, approver, requestor] = await Promise.all([
              userInRole(orgId, context.nearAccountId!, adminRole),
              userInRole(orgId, context.nearAccountId!, approverRole),
              userInRole(orgId, context.nearAccountId!, requestorRole),
            ]);
            if (!admin && !approver && !requestor) {
              const isAssigned = contributorRows.some(
                (c) => c.nearAccountId && c.nearAccountId === context.nearAccountId,
              );
              if (!isAssigned) {
                throw new ORPCError("FORBIDDEN", {
                  message: `Project access requires ${adminRole}/${approverRole}/${requestorRole} role or contributor assignment`,
                });
              }
            }

            return { project: projectRow, contributors: contributorRows };
          }),

        getBudget: builder.projects.getBudget.use(gates.approver).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const projectExists = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, orgId)))
            .limit(1);
          if (projectExists.length === 0)
            throw new ORPCError("NOT_FOUND", { message: "Project not found" });
          return { budgets: await computeBudget(input.projectId) };
        }),

        adminList: builder.projects.adminList.use(gates.member).handler(async () => {
          const orgId = await getOrgId();
          const rows = await db
            .select()
            .from(projects)
            .where(eq(projects.organizationId, orgId))
            .orderBy(desc(projects.updatedAt));
          return { data: rows };
        }),

        adminCreate: builder.projects.adminCreate
          .use(gates.operator)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgId();
            const id = crypto.randomUUID();
            const now = new Date();
            const insertResult = await db
              .insert(projects)
              .values({
                id,
                ownerId: context.nearAccountId!,
                organizationId: orgId,
                slug: input.slug,
                title: input.title,
                description: input.description ?? null,
                nearnListingId: input.nearnListingId ?? null,
                status: input.status,
                visibility: input.visibility,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            const row = insertResult[0];
            if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" });
            return { project: row };
          }),

        adminUpdate: builder.projects.adminUpdate.use(gates.operator).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const { id, ...patch } = input;
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) updates[k] = v;
          }
          const result = await db
            .update(projects)
            .set(updates)
            .where(and(eq(projects.id, id), eq(projects.organizationId, orgId)))
            .returning();
          const row = result[0];
          if (!row) throw new ORPCError("NOT_FOUND", { message: "Project not found" });
          return { project: row };
        }),
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
        adminList: builder.assignments.adminList.use(gates.operator).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const rows = await db
            .select({
              projectId: projectContributors.projectId,
              contributorId: projectContributors.contributorId,
              role: projectContributors.role,
              createdAt: projectContributors.createdAt,
              contributor: contributors,
            })
            .from(projectContributors)
            .innerJoin(projects, eq(projectContributors.projectId, projects.id))
            .innerJoin(contributors, eq(projectContributors.contributorId, contributors.id))
            .where(
              and(
                eq(projects.organizationId, orgId),
                eq(projectContributors.projectId, input.projectId),
              ),
            );
          return { data: rows };
        }),

        adminCreate: builder.assignments.adminCreate
          .use(gates.operator)
          .handler(async ({ input }) => {
            const orgId = await getOrgId();
            const projectExists = await db
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, orgId)))
              .limit(1);
            if (projectExists.length === 0)
              throw new ORPCError("NOT_FOUND", { message: "Project not found" });

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

      allocations: {
        adminList: builder.allocations.adminList.use(gates.operator).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const rows = await db
            .select({
              id: allocations.id,
              projectId: allocations.projectId,
              tokenId: allocations.tokenId,
              amount: allocations.amount,
              note: allocations.note,
              actorAccountId: allocations.actorAccountId,
              relatedAllocationId: allocations.relatedAllocationId,
              createdAt: allocations.createdAt,
            })
            .from(allocations)
            .innerJoin(projects, eq(allocations.projectId, projects.id))
            .where(
              and(
                eq(projects.organizationId, orgId),
                input.projectId ? eq(allocations.projectId, input.projectId) : undefined,
                input.tokenId ? eq(allocations.tokenId, input.tokenId) : undefined,
                cursorWhere(allocations.createdAt, allocations.id, input.cursor),
              ),
            )
            .orderBy(desc(allocations.createdAt), desc(allocations.id))
            .limit(input.limit);
          const last = rows[rows.length - 1];
          return {
            data: rows,
            nextCursor:
              rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
          };
        }),

        adminCreate: builder.allocations.adminCreate
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgId();
            const projectExists = await db
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, orgId)))
              .limit(1);
            if (projectExists.length === 0)
              throw new ORPCError("NOT_FOUND", { message: "Project not found" });

            const id = crypto.randomUUID();
            const result = await db
              .insert(allocations)
              .values({
                id,
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: context.nearAccountId!,
              })
              .returning();
            const row = result[0];
            if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" });
            return { allocation: row };
          }),

        adminDeallocate: builder.allocations.adminDeallocate
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgId();
            const projectExists = await db
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, orgId)))
              .limit(1);
            if (projectExists.length === 0)
              throw new ORPCError("NOT_FOUND", { message: "Project not found" });

            const id = crypto.randomUUID();
            const result = await db
              .insert(allocations)
              .values({
                id,
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: (-BigInt(input.amount)).toString(),
                note: input.note ?? null,
                actorAccountId: context.nearAccountId!,
              })
              .returning();
            const row = result[0];
            if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Insert failed" });
            return { allocation: row };
          }),

        adminTransfer: builder.allocations.adminTransfer
          .use(gates.approver)
          .handler(async ({ context, input }) => {
            const orgId = await getOrgId();
            const matching = await db
              .select({ id: projects.id })
              .from(projects)
              .where(eq(projects.organizationId, orgId));
            const ownedProjectIds = new Set(matching.map((p) => p.id));
            if (
              !ownedProjectIds.has(input.fromProjectId) ||
              !ownedProjectIds.has(input.toProjectId)
            ) {
              throw new ORPCError("NOT_FOUND", {
                message: "fromProjectId and toProjectId must both belong to this agency",
              });
            }

            const transferAmount = BigInt(input.amount);
            const fromId = crypto.randomUUID();
            const toId = crypto.randomUUID();
            const now = new Date();
            const note = input.note ?? null;
            const actor = context.nearAccountId!;

            const inserted = await db
              .insert(allocations)
              .values([
                {
                  id: fromId,
                  projectId: input.fromProjectId,
                  tokenId: input.tokenId,
                  amount: (-transferAmount).toString(),
                  note,
                  actorAccountId: actor,
                  relatedAllocationId: toId,
                  createdAt: now,
                },
                {
                  id: toId,
                  projectId: input.toProjectId,
                  tokenId: input.tokenId,
                  amount: transferAmount.toString(),
                  note,
                  actorAccountId: actor,
                  relatedAllocationId: fromId,
                  createdAt: now,
                },
              ])
              .returning();
            const fromRow = inserted.find((r) => r.id === fromId);
            const toRow = inserted.find((r) => r.id === toId);
            if (!fromRow || !toRow) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Transfer insert failed" });
            }
            return { from: fromRow, to: toRow };
          }),
      },

      billings: {
        adminList: builder.billings.adminList.use(gates.operator).handler(async ({ input }) => {
          const orgId = await getOrgId();
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
            .innerJoin(projects, eq(billings.projectId, projects.id))
            .where(
              and(
                eq(projects.organizationId, orgId),
                input.projectId ? eq(billings.projectId, input.projectId) : undefined,
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

        adminCreate: builder.billings.adminCreate.use(gates.approver).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const projectExists = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, orgId)))
            .limit(1);
          if (projectExists.length === 0)
            throw new ORPCError("NOT_FOUND", { message: "Project not found" });

          const proposalIdNum = Number.parseInt(input.proposalId, 10);
          if (Number.isNaN(proposalIdNum))
            throw new ORPCError("BAD_REQUEST", { message: "Invalid proposal id" });

          const existing = await db
            .select({
              billingId: billings.id,
              projectSlug: projects.slug,
              projectTitle: projects.title,
            })
            .from(billings)
            .innerJoin(projects, eq(billings.projectId, projects.id))
            .where(eq(billings.proposalId, input.proposalId))
            .limit(1);
          if (existing.length > 0) {
            const e = existing[0]!;
            throw new ORPCError("BAD_REQUEST", {
              message: `Proposal ${input.proposalId} is already assigned to ${e.projectTitle} (@${e.projectSlug})`,
            });
          }

          const proposal = await getProposal(orgId, proposalIdNum);
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
              tokenId: proposal.kind.tokenId === "" ? "near" : proposal.kind.tokenId,
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
      },

      proposals: {
        adminList: builder.proposals.adminList.use(gates.operator).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const lastProposalId = await getLastProposalId(orgId);

          // MAX_ITERATIONS bounds RPC cost when the recent window is governance-only.
          const PAGE_SIZE = 100;
          const MAX_ITERATIONS = 5;
          const transfers: DaoProposal[] = [];
          let cursor = input.fromIndex ?? lastProposalId;
          let iterations = 0;
          while (transfers.length < input.limit && cursor > 0 && iterations < MAX_ITERATIONS) {
            const fromIndex = Math.max(0, cursor - PAGE_SIZE);
            const fetched = await getProposals(orgId, fromIndex, cursor - fromIndex);
            for (const p of fetched.slice().reverse()) {
              if (p.kind.type === "Transfer") {
                transfers.push(p);
                if (transfers.length >= input.limit) break;
              }
            }
            cursor = fromIndex;
            iterations++;
          }
          const nextFromIndex = cursor > 0 ? cursor : null;

          const proposalIdStrs = transfers.map((p) => String(p.id));
          const localBillings =
            proposalIdStrs.length > 0
              ? await db
                  .select({
                    billingId: billings.id,
                    proposalId: billings.proposalId,
                    projectId: billings.projectId,
                    projectSlug: projects.slug,
                    projectTitle: projects.title,
                  })
                  .from(billings)
                  .innerJoin(projects, eq(billings.projectId, projects.id))
                  .where(inArray(billings.proposalId, proposalIdStrs))
              : [];
          const mappingByProposal = new Map(localBillings.map((b) => [b.proposalId, b]));

          const data = transfers.map((p) => {
            const transfer = p.kind.type === "Transfer" ? p.kind : null;
            const mapping = mappingByProposal.get(String(p.id)) ?? null;
            return {
              proposalId: String(p.id),
              proposer: p.proposer,
              description: p.description,
              status: p.status,
              tokenId: transfer ? (transfer.tokenId === "" ? "near" : transfer.tokenId) : "",
              receiverId: transfer?.receiverId ?? "",
              amount: transfer?.amount ?? "0",
              submissionTime: p.submissionTime,
              mapping: mapping
                ? {
                    billingId: mapping.billingId,
                    projectId: mapping.projectId,
                    projectSlug: mapping.projectSlug,
                    projectTitle: mapping.projectTitle,
                  }
                : null,
            };
          });

          return { data, lastProposalId, nextFromIndex };
        }),
      },

      nearn: {
        getListing: builder.nearn.getListing.use(gates.operator).handler(async ({ input }) => {
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
          .handler(async () => {
            const settingsRows = await db
              .select({ nearnAccountId: agencySettings.nearnAccountId })
              .from(agencySettings)
              .where(eq(agencySettings.id, SETTINGS_ID))
              .limit(1);
            const sponsorSlug = settingsRows[0]?.nearnAccountId ?? null;
            if (!sponsorSlug) {
              return { sponsorSlug: null, bounties: [] };
            }
            const bounties = await listNearnBountiesForSponsor(sponsorSlug);
            return { sponsorSlug, bounties };
          }),
      },

      tokens: {
        list: builder.tokens.list.use(gates.member).handler(async () => {
          return { tokens: KNOWN_TOKENS };
        }),
      },

      treasury: {
        getBalances: builder.treasury.getBalances.use(gates.approver).handler(async ({ input }) => {
          const orgId = await getOrgId();
          const [balances, allocationRows] = await Promise.all([
            getTreasuryBalances(orgId, input.tokenIds),
            db
              .select({ tokenId: allocations.tokenId, amount: allocations.amount })
              .from(allocations)
              .innerJoin(projects, eq(allocations.projectId, projects.id))
              .where(eq(projects.organizationId, orgId)),
          ]);
          const totals = new Map<string, bigint>();
          for (const row of allocationRows) {
            totals.set(row.tokenId, (totals.get(row.tokenId) ?? 0n) + BigInt(row.amount));
          }
          return {
            balances: input.tokenIds.map((tokenId) => ({
              tokenId,
              balance: balances[tokenId] ?? "0",
              totalAllocated: (totals.get(tokenId) ?? 0n).toString(),
            })),
          };
        }),
      },

      me: {
        assignedProjects: builder.me.assignedProjects
          .use(requireSession)
          .handler(async ({ context }) => {
            const orgId = await getOrgId();
            const myContributor = await db
              .select({ id: contributors.id })
              .from(contributors)
              .where(eq(contributors.nearAccountId, context.nearAccountId!))
              .limit(1);
            const me = myContributor[0];
            if (!me) return { data: [] };

            const rows = await db
              .select({
                id: projects.id,
                ownerId: projects.ownerId,
                organizationId: projects.organizationId,
                slug: projects.slug,
                title: projects.title,
                description: projects.description,
                nearnListingId: projects.nearnListingId,
                status: projects.status,
                visibility: projects.visibility,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
                role: projectContributors.role,
              })
              .from(projectContributors)
              .innerJoin(projects, eq(projectContributors.projectId, projects.id))
              .where(
                and(
                  eq(projectContributors.contributorId, me.id),
                  eq(projects.organizationId, orgId),
                ),
              )
              .orderBy(desc(projects.updatedAt));
            return { data: rows };
          }),
      },

      team: {
        list: builder.team.list.use(requireSession).handler(async () => {
          const orgId = await getOrgId();
          const roles = await getRoles(orgId);
          return { roles };
        }),
      },

      settings: {
        getPublic: builder.settings.getPublic.handler(async () => {
          const rows = await db
            .select({
              name: agencySettings.name,
              headline: agencySettings.headline,
              tagline: agencySettings.tagline,
              contactEmail: agencySettings.contactEmail,
              nearnAccountId: agencySettings.nearnAccountId,
              websiteUrl: agencySettings.websiteUrl,
              docsUrl: agencySettings.docsUrl,
              daoAccountId: agencySettings.daoAccountId,
            })
            .from(agencySettings)
            .where(eq(agencySettings.id, SETTINGS_ID))
            .limit(1);
          const row = rows[0];
          return {
            name: row?.name ?? "",
            headline: row?.headline ?? null,
            tagline: row?.tagline ?? null,
            contactEmail: row?.contactEmail ?? null,
            nearnAccountId: row?.nearnAccountId ?? null,
            websiteUrl: row?.websiteUrl ?? null,
            docsUrl: row?.docsUrl ?? null,
            isPlaceholder: (row?.daoAccountId ?? DEFAULT_DAO_ACCOUNT) === DEFAULT_DAO_ACCOUNT,
          };
        }),

        adminGet: builder.settings.adminGet.use(gates.operator).handler(async () => {
          const rows = await db
            .select()
            .from(agencySettings)
            .where(eq(agencySettings.id, SETTINGS_ID))
            .limit(1);
          const row = rows[0];
          if (!row) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Agency settings not initialized",
            });
          }
          return { settings: row };
        }),

        adminUpdate: builder.settings.adminUpdate
          .use(gates.admin)
          .handler(async ({ context, input }) => {
            if (input.daoAccountId !== undefined) {
              const currentRows = await db
                .select()
                .from(agencySettings)
                .where(eq(agencySettings.id, SETTINGS_ID))
                .limit(1);
              const current = currentRows[0];
              if (!current) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", {
                  message: "Agency settings not initialized",
                });
              }
              if (input.daoAccountId !== current.daoAccountId) {
                const prospective = {
                  ...current,
                  adminRoleName: input.adminRoleName ?? current.adminRoleName,
                };
                const adminRole = resolveRoleName("admin", prospective);
                const adminOnNew = await userInRole(
                  input.daoAccountId,
                  context.nearAccountId!,
                  adminRole,
                );
                if (!adminOnNew) {
                  throw new ORPCError("FORBIDDEN", {
                    message: `Cannot move admin authority to a DAO where you are not a ${adminRole}.`,
                  });
                }
              }
            }
            const updates: Record<string, unknown> = { updatedAt: new Date() };
            for (const [k, v] of Object.entries(input)) {
              if (v !== undefined) updates[k] = v;
            }
            const result = await db
              .update(agencySettings)
              .set(updates)
              .where(eq(agencySettings.id, SETTINGS_ID))
              .returning();
            const row = result[0];
            if (!row) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Agency settings not initialized",
              });
            }
            return { settings: row };
          }),
      },

      bootstrap: {
        config: builder.bootstrap.config.use(requireSession).handler(({ context, input }) =>
          claimDaoConfig({
            db,
            nearAccountId: context.nearAccountId!,
            input,
            isAdmin: userInRole,
          }),
        ),
      },
    };
  },
});
