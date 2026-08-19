import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import { flagsToLifecycle, lifecycleToFlags } from "./lib/listing-lifecycle";
import { getNetwork, pinnedNetwork } from "./lib/network";
import { getDaoAccountIdOrThrow, setDefaultDaoAccountId } from "./lib/org";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { createAgencyService } from "./services/agency";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createClientPortalService, getNearAccountFromContext } from "./services/client-portal";
import { createClientsService } from "./services/clients";
import { createContributorsService } from "./services/contributors";
import { createListingsService } from "./services/listings";
import { createMeService } from "./services/me";
import { createNearnService } from "./services/nearn";
import { createProposalsService } from "./services/proposals";
import { createReportsService } from "./services/reports";
import {
  defaultPublicSettings,
  getResolvedPublicSettings,
  getSettingsRow,
  upsertSettings,
} from "./services/settings-admin";
import { getRoles } from "./services/sputnik";
import { createTokensService } from "./services/tokens";
import { createTreasuryService } from "./services/treasury";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    agencyDaoAccount: z.string().optional(),
  }),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
    APPLICATIONS_WEBHOOK_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NOTIFY_FROM_EMAIL: z.string().optional(),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, plugins, tools) =>
    Effect.gen(function* () {
      setDefaultDaoAccountId(config.variables.agencyDaoAccount);

      const db = yield* tools.buildService(
        DatabaseTag,
        DatabaseLive(config.secrets.API_DATABASE_URL),
      );

      const notifyConfig = {
        webhookUrl: config.secrets.APPLICATIONS_WEBHOOK_URL,
        resendApiKey: config.secrets.RESEND_API_KEY,
        fromEmail: config.secrets.NOTIFY_FROM_EMAIL,
      };

      const agency = createAgencyService(db, plugins);
      const listings = createListingsService(db);
      const contributors = createContributorsService(db, plugins);
      const applications = createApplicationsService(db, notifyConfig, contributors);
      const clients = createClientsService(db);
      const assignments = createAssignmentsService(db);
      const budgets = createBudgetsService(db);
      const billings = createBillingsService(db, agency);
      const reports = createReportsService(db, agency, plugins);
      const clientPortal = createClientPortalService(clients, agency, billings, reports);
      const me = createMeService(db, agency);
      const proposals = createProposalsService(db, agency);
      const tokens = createTokensService(db);
      const treasury = createTreasuryService(db, agency, listings);
      const nearn = createNearnService();

      yield* Effect.logInfo(`[API] plugins.projects available: ${typeof plugins?.projects}`);
      yield* Effect.logInfo("[API] Services Initialized");
      return {
        db,
        applications,
        agency,
        listings,
        contributors,
        clients,
        assignments,
        budgets,
        billings,
        reports,
        clientPortal,
        me,
        proposals,
        tokens,
        treasury,
        nearn,
      };
    }),

  shutdown: () => Effect.logInfo("[API] Shutdown"),

  createRouter: (services, builder) => {
    const { db } = services;
    const {
      applications,
      agency,
      listings,
      contributors,
      clients,
      assignments,
      budgets,
      billings,
      reports,
      clientPortal,
      me,
      proposals,
      tokens,
      treasury,
      nearn,
    } = services;
    const auth = createAuthMiddleware(builder);

    const withLifecycle = <
      T extends {
        isPublished?: boolean | null;
        isWinnersAnnounced?: boolean | null;
        isArchived?: boolean | null;
      },
    >(
      listing: T,
    ) => ({
      ...listing,
      lifecycle: flagsToLifecycle(listing),
    });

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      applications: {
        create: builder.applications.create.handler(async ({ input }) =>
          runEffect(applications.create(input)),
        ),

        list: builder.applications.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ input }) => runEffect(applications.list(input))),

        update: builder.applications.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) =>
            runEffect(applications.update(context as any, input)),
          ),

        convertToBuilder: builder.applications.convertToBuilder
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) =>
            runEffect(applications.convertToBuilder(context as any, input)),
          ),
      },

      agency: {
        projects: {
          list: builder.agency.projects.list.handler(async ({ context }) =>
            runEffect(agency.listProjects(context)),
          ),

          get: builder.agency.projects.get
            .use(auth.requireOrganization)
            .handler(async ({ context, input }) =>
              runEffect(agency.getProject(context, input.slug)),
            ),

          getBudget: builder.agency.projects.getBudget
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) =>
              runEffect(agency.getBudget(context, input.projectId)),
            ),

          create: builder.agency.projects.create
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => runEffect(agency.createProject(context, input))),

          update: builder.agency.projects.update
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => runEffect(agency.updateProject(context, input))),

          delete: builder.agency.projects.delete
            .use(auth.requireOrgRole("admin", "owner"))
            .handler(async ({ context, input }) => runEffect(agency.deleteProject(context, input))),
        },

        listings: {
          get: builder.agency.listings.get
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgId = getDaoAccountIdOrThrow(context);
              const row = await runEffect(
                Effect.promise(() =>
                  agency.requireProjectInOrg(input.projectId, orgId, context),
                ).pipe(
                  Effect.andThen(() =>
                    listings.getListingForProject(input.projectId, "internal", orgId, {
                      skipRefresh: true,
                    }),
                  ),
                  Effect.map((listing) => ({
                    listing: listing ? withLifecycle(listing) : null,
                  })),
                ),
              );
              return row;
            }),

          create: builder.agency.listings.create
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgId = getDaoAccountIdOrThrow(context);
              return runEffect(
                Effect.promise(() =>
                  agency.requireProjectInOrg(input.projectId, orgId, context),
                ).pipe(
                  Effect.andThen(() => {
                    const flags = lifecycleToFlags(input.lifecycle ?? "draft");
                    const fields = {
                      title: input.title,
                      type: input.type,
                      token: input.token,
                      rewardAmount: input.rewardAmount,
                      description: input.description ?? null,
                      deadline: input.deadline ?? null,
                      ...flags,
                    };
                    return listings.createInternalListing(input.projectId, fields);
                  }),
                  Effect.map((listing) => ({ listing: withLifecycle(listing) })),
                ),
              );
            }),

          update: builder.agency.listings.update
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgAccountId = getDaoAccountIdOrThrow(context);
              const { projectId, lifecycle, ...rest } = input;
              const patch = {
                ...rest,
                ...(lifecycle ? lifecycleToFlags(lifecycle) : {}),
              };
              return runEffect(
                Effect.promise(() =>
                  agency.requireProjectInOrg(projectId, orgAccountId, context),
                ).pipe(
                  Effect.andThen(() => listings.updateInternalListing(projectId, patch)),
                  Effect.andThen((row) => {
                    if (!row) {
                      return Effect.fail(
                        new ORPCError("NOT_FOUND", {
                          message: "No internal listing exists for this project",
                        }),
                      );
                    }
                    return Effect.succeed({ listing: withLifecycle(row) });
                  }),
                ),
              );
            }),

          delete: builder.agency.listings.delete
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgAccountId = getDaoAccountIdOrThrow(context);
              return runEffect(
                Effect.promise(() =>
                  agency.requireProjectInOrg(input.projectId, orgAccountId, context),
                ).pipe(
                  Effect.andThen(() => listings.deleteInternalListing(input.projectId)),
                  Effect.andThen((removed) => {
                    if (!removed) {
                      return Effect.fail(
                        new ORPCError("NOT_FOUND", {
                          message: "No internal listing exists for this project",
                        }),
                      );
                    }
                    return Effect.succeed({ deleted: true as const });
                  }),
                ),
              );
            }),
        },

        reports: {
          generate: builder.agency.reports.generate
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgId = getDaoAccountIdOrThrow(context);
              return runEffect(reports.generate(context, orgId, input));
            }),
        },
      },

      clients: {
        list: builder.clients.list
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async () => runEffect(clients.list())),

        get: builder.clients.get
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ input }) => runEffect(clients.get(input.id))),

        lookupByNearAccount: builder.clients.lookupByNearAccount
          .use(auth.requireAuth)
          .handler(async ({ input }) => {
            const memberships = await runEffect(clients.listByNearAccount(input.nearAccountId));
            return { memberships };
          }),

        create: builder.clients.create
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const agencyDaoAccountId = getDaoAccountIdOrThrow(context);
            return runEffect(
              clients.create(context, {
                ...input,
                agencyDaoAccountId,
              }),
            );
          }),

        update: builder.clients.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const agencyDaoAccountId = getDaoAccountIdOrThrow(context);
            return runEffect(
              clients.update({
                ...input,
                agencyDaoAccountId,
              }),
            );
          }),

        delete: builder.clients.delete
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ input }) => runEffect(clients.delete(input.id))),
      },

      clientPortal: {
        dashboard: {
          summary: builder.clientPortal.dashboard.summary
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              return runEffect(
                clientPortal.dashboardSummary(nearAccountId, input.agencyDaoAccountId, context),
              );
            }),
        },

        projects: {
          list: builder.clientPortal.projects.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              return runEffect(
                clientPortal.listProjects(nearAccountId, input.agencyDaoAccountId, context),
              );
            }),

          get: builder.clientPortal.projects.get
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              return runEffect(
                clientPortal.getProject(
                  nearAccountId,
                  input.agencyDaoAccountId,
                  input.slug,
                  context,
                ),
              );
            }),

          getBudget: builder.clientPortal.projects.getBudget
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              return runEffect(
                clientPortal.getBudget(
                  nearAccountId,
                  input.agencyDaoAccountId,
                  input.projectId,
                  context,
                ),
              );
            }),
        },

        billings: {
          list: builder.clientPortal.billings.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              const { agencyDaoAccountId, ...rest } = input;
              return runEffect(
                clientPortal.listBillings(nearAccountId, agencyDaoAccountId, rest, context),
              );
            }),
        },

        reports: {
          generate: builder.clientPortal.reports.generate
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const nearAccountId = getNearAccountFromContext(context);
              const { agencyDaoAccountId, note, startDate, endDate } = input;
              return runEffect(
                clientPortal.generateReport(
                  nearAccountId,
                  agencyDaoAccountId,
                  { note, startDate, endDate },
                  context,
                ),
              );
            }),
        },
      },

      contributors: {
        list: builder.contributors.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context }) => runEffect(contributors.list(context))),

        get: builder.contributors.get
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) =>
            runEffect(contributors.get(context, input.nearAccount)),
          ),

        create: builder.contributors.create
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => runEffect(contributors.create(context, input))),

        update: builder.contributors.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => runEffect(contributors.update(context, input))),
      },

      assignments: {
        list: builder.assignments.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => {
            const orgAccountId = getDaoAccountIdOrThrow(context);
            return runEffect(
              Effect.promise(() =>
                agency.requireProjectInOrg(input.projectId, orgAccountId, context),
              ).pipe(Effect.andThen(() => assignments.list(input.projectId))),
            );
          }),

        listAll: builder.assignments.listAll
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context }) => {
            const orgAccountId = getDaoAccountIdOrThrow(context);
            const [rows, orgProjects] = await Promise.all([
              runEffect(assignments.listAll()),
              agency.fetchOrgProjects(orgAccountId, context),
            ]);
            return {
              data: rows.data
                .map((row) => {
                  const project = orgProjects.find((p) => p.id === row.projectId);
                  if (!project) return null;
                  return {
                    projectId: row.projectId,
                    projectSlug: project.slug,
                    projectTitle: project.title,
                    nearAccount: row.nearAccount,
                    role: row.role,
                    onboardingStatus: row.onboardingStatus,
                    createdAt: row.createdAt,
                  };
                })
                .filter((r): r is NonNullable<typeof r> => r !== null),
            };
          }),

        create: builder.assignments.create
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => {
            const orgAccountId = getDaoAccountIdOrThrow(context);
            return runEffect(
              Effect.promise(() =>
                agency.requireProjectInOrg(input.projectId, orgAccountId, context),
              ).pipe(Effect.andThen(() => assignments.create(input))),
            );
          }),

        delete: builder.assignments.delete
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ input }) => runEffect(assignments.delete(input))),
      },

      budgets: {
        list: builder.budgets.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            if (input.projectId)
              await runEffect(
                Effect.promise(() => agency.requireProjectInOrg(input.projectId!, orgId, context)),
              );

            let projectIds: string[] | null = input.projectId ? [input.projectId] : null;
            if (input.clientId) {
              const clientProjectIds = await runEffect(
                clients.getProjectIdsForClient(input.clientId),
              );
              projectIds =
                projectIds === null
                  ? clientProjectIds
                  : projectIds.filter((id) => clientProjectIds.includes(id));
            }

            return runEffect(
              Effect.promise(() =>
                budgets.list({
                  projectIds,
                  tokenId: input.tokenId,
                  clientId: input.clientId,
                  cursor: input.cursor,
                  limit: input.limit,
                }),
              ),
            );
          }),

        create: builder.budgets.create
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            await agency.requireProjectInOrg(input.projectId, orgId, context);
            const actorId =
              (context.near?.primaryAccountId as string) ?? context.userId ?? "unknown";
            const budget = await runEffect(
              budgets.create({
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: actorId,
                clientId: input.clientId ?? null,
              }) as any,
            );
            return { budget } as any;
          }),

        deallocate: builder.budgets.deallocate
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            await agency.requireProjectInOrg(input.projectId, orgId, context);
            const actorId =
              (context.near?.primaryAccountId as string) ?? context.userId ?? "unknown";
            const budget = await runEffect(
              budgets.deallocate({
                projectId: input.projectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: actorId,
                clientId: input.clientId ?? null,
              }) as any,
            );
            return { budget } as any;
          }),

        transfer: builder.budgets.transfer
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            await agency.requireProjectInOrg(input.fromProjectId, orgId, context);
            await agency.requireProjectInOrg(input.toProjectId, orgId, context);
            const actorId =
              (context.near?.primaryAccountId as string) ?? context.userId ?? "unknown";
            const result = await runEffect(
              budgets.transfer({
                fromProjectId: input.fromProjectId,
                toProjectId: input.toProjectId,
                tokenId: input.tokenId,
                amount: input.amount,
                note: input.note ?? null,
                actorAccountId: actorId,
              }) as any,
            );
            return result as any;
          }),
      },

      billings: {
        list: builder.billings.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            return runEffect(billings.list(input, orgId, context));
          }),

        create: builder.billings.create
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            return runEffect(billings.create(input, orgId, context));
          }),

        delete: builder.billings.delete
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            return runEffect(billings.delete(input, orgId, context));
          }),
      },

      proposals: {
        list: builder.proposals.list.handler(async ({ context, input }) =>
          runEffect(proposals.list(context, input)),
        ),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) =>
          runEffect(proposals.getPublicSummary(context)),
        ),
      },

      nearn: {
        getListing: builder.nearn.getListing
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => runEffect(nearn.getListing(context, input))),

        listSponsorBounties: builder.nearn.listSponsorBounties
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context }) => runEffect(nearn.listSponsorBounties(context))),

        listSubmissions: builder.nearn.listSubmissions
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => runEffect(nearn.listSubmissions(context, input))),
      },

      tokens: {
        list: builder.tokens.list.handler(async ({ context }) => runEffect(tokens.list(context))),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) =>
          runEffect(tokens.getStorageStatus(context, input)),
        ),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(async ({ context, input }) =>
          runEffect(treasury.getPublicBalances(context, input)),
        ),

        getBalances: builder.treasury.getBalances
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context, input }) => runEffect(treasury.getBalances(context, input))),

        getRollups: builder.treasury.getRollups
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context }) => runEffect(treasury.getRollups(context))),

        getPublicSummary: builder.treasury.getPublicSummary.handler(async ({ context }) =>
          runEffect(treasury.getPublicSummary(context)),
        ),
      },

      me: {
        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const role = context.organization?.member?.role as
            | "admin"
            | "member"
            | "owner"
            | null
            | undefined;
          return { orgRole: role ?? null };
        }),

        assignedProjects: builder.me.assignedProjects
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async ({ context }) => {
            const orgId = getDaoAccountIdOrThrow(context);
            const nearAccount = context.near?.primaryAccountId as string | undefined;
            if (!nearAccount) {
              throw new ORPCError("FORBIDDEN", {
                message: "Link a NEAR wallet to view assigned projects",
              });
            }
            return runEffect(me.assignedProjects(context, orgId, nearAccount));
          }),
      },

      team: {
        list: builder.team.list.handler(async ({ context }) => {
          const orgAccountId = getDaoAccountIdOrThrow(context);
          try {
            const roles = await getRoles(orgAccountId);
            return { roles };
          } catch {
            return { roles: [] };
          }
        }),
      },

      agencyConfig: {
        getPublic: builder.agencyConfig.getPublic.handler(async ({ context }) => {
          const network = getNetwork(context.reqHeaders);
          const resolved = await getResolvedPublicSettings(db, network);
          return {
            ...resolved,
            network,
            networkPinned: pinnedNetwork() !== null,
          };
        }),

        get: builder.agencyConfig.get
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context }) => {
            const network = getNetwork(context.reqHeaders);
            const daoAccountId = getDaoAccountIdOrThrow(context);
            const row = await getSettingsRow(db, daoAccountId);
            const base = defaultPublicSettings(network);
            return {
              orgAccountId: row?.orgAccountId ?? daoAccountId,
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

        update: builder.agencyConfig.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const settingsKey = getDaoAccountIdOrThrow(context);
            const actorId = context.near?.primaryAccountId ?? context.userId ?? "unknown";
            await upsertSettings(
              db,
              settingsKey,
              {
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
    };
  },
});
