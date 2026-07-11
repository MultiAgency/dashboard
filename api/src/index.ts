import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { createDatabaseDriver } from "./db";
import { loadMigrations } from "./db/load-migrations";
import { migrate } from "./db/migrator";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import { getNetwork, pinnedNetwork } from "./lib/network";
import { getDaoAccountIdOrThrow } from "./lib/org";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { createAgencyService } from "./services/agency";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createContributorsService } from "./services/contributors";
import { createListingsService } from "./services/listings";
import { createNearnService } from "./services/nearn";
import { createProposalsService } from "./services/proposals";
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
  variables: z.object({}),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
    APPLICATIONS_WEBHOOK_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NOTIFY_FROM_EMAIL: z.string().optional(),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, plugins) =>
    Effect.promise(async () => {
      const driver = await createDatabaseDriver(config.secrets.API_DATABASE_URL);
      const db = driver.db;
      const migrations = await loadMigrations();
      await migrate(db, migrations);
      console.log("[API] Services Initialized");

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

    const applications = createApplicationsService(db, notifyConfig);
    const agency = createAgencyService(db, plugins);
    const listings = createListingsService(db);
    const contributors = createContributorsService(db);
    const assignments = createAssignmentsService(db);
    const budgets = createBudgetsService(db);
    const billings = createBillingsService(db, agency);
    const proposals = createProposalsService(db, agency);
    const tokens = createTokensService(db);
    const treasury = createTreasuryService(db, agency, listings);
    const nearn = createNearnService();

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
      },

      agency: {
        projects: {
          list: builder.agency.projects.list
            .use(auth.requireOrganization)
            .handler(async ({ context }) => runEffect(agency.listProjects(context))),

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
                  Effect.map((listing) => ({ listing })),
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
                    const fields = {
                      title: input.title,
                      type: input.type,
                      token: input.token,
                      rewardAmount: input.rewardAmount,
                      description: input.description ?? null,
                      deadline: input.deadline ?? null,
                      isPublished: input.isPublished ?? false,
                      isArchived: input.isArchived ?? false,
                      isWinnersAnnounced: input.isWinnersAnnounced ?? false,
                    };
                    return listings.createInternalListing(input.projectId, fields);
                  }),
                  Effect.map((listing) => ({ listing })),
                ),
              );
            }),

          update: builder.agency.listings.update
            .use(auth.requireOrgRole("admin", "owner", "member"))
            .handler(async ({ context, input }) => {
              const orgAccountId = getDaoAccountIdOrThrow(context);
              const { projectId, ...patch } = input;
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
                    return Effect.succeed({ listing: row });
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
      },

      contributors: {
        list: builder.contributors.list
          .use(auth.requireOrgRole("admin", "owner", "member"))
          .handler(async () => runEffect(contributors.list())),

        create: builder.contributors.create
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ input }) => runEffect(contributors.create(input))),

        update: builder.contributors.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ input }) => runEffect(contributors.update(input))),
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
            return runEffect(
              Effect.promise(() =>
                budgets.list({
                  projectIds: input.projectId ? [input.projectId] : null,
                  tokenId: input.tokenId,
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

        update: builder.agencyConfig.update
          .use(auth.requireOrgRole("admin", "owner"))
          .handler(async ({ context, input }) => {
            const settingsKey = getDaoAccountIdOrThrow(context);
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
    };
  },
});
