import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { ContextSchema, runEffect } from "./lib/context";
import { getNetwork, pinnedNetwork } from "./lib/network";
import { betterAuthOrganizations } from "./lib/organizations";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { createAgencyService } from "./services/agency";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createClientPortalService } from "./services/client-portal";
import { createClientsService } from "./services/clients";
import { createContactFormService } from "./services/contact-form";
import { createContributorsService } from "./services/contributors";
import { createProjectLedgers } from "./services/ledger";
import { createListingsService } from "./services/listings";
import { createMeService } from "./services/me";
import { createNearnService } from "./services/nearn";
import { createOrganizationAccess } from "./services/organization-access";
import { createProjectDirectory } from "./services/project-directory";
import { createProposalsService } from "./services/proposals";
import { createReportsService } from "./services/reports";
import {
  getAdminSettings,
  getResolvedPublicSettings,
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
    CONTACT_FORM_WEBHOOK_URL: z.string().optional(),
    CONTACT_FORM_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NOTIFY_FROM_EMAIL: z.string().optional(),
  }),

  context: ContextSchema,

  contract,

  initialize: (config, plugins, tools) =>
    Effect.gen(function* () {
      const db = yield* tools.buildService(
        DatabaseTag,
        DatabaseLive(config.secrets.API_DATABASE_URL),
      );

      const notifyConfig = {
        webhookUrl: config.secrets.APPLICATIONS_WEBHOOK_URL,
        resendApiKey: config.secrets.RESEND_API_KEY,
        fromEmail: config.secrets.NOTIFY_FROM_EMAIL,
      };

      const directory = createProjectDirectory((pluginContext) => plugins.projects(pluginContext));
      const access = createOrganizationAccess({
        db,
        organizations: betterAuthOrganizations(() => plugins.auth()),
        defaultDaoAccountId: config.variables.agencyDaoAccount,
      });
      const listings = createListingsService(db, directory);
      const projectLedgers = createProjectLedgers(db, listings);
      const agency = createAgencyService(db, plugins, directory, listings, projectLedgers);
      const contributors = createContributorsService(db, plugins);
      const applications = createApplicationsService(db, notifyConfig, contributors);
      const contactForm = createContactFormService({
        webhookUrl: config.secrets.CONTACT_FORM_WEBHOOK_URL,
        webhookSecret: config.secrets.CONTACT_FORM_WEBHOOK_SECRET,
      });
      const clients = createClientsService(db, directory);
      const assignments = createAssignmentsService(db, directory);
      const budgets = createBudgetsService(db, directory, clients);
      const billings = createBillingsService(db, directory);
      const reports = createReportsService(db, directory, plugins);
      const clientPortal = createClientPortalService(
        access,
        agency,
        billings,
        reports,
        directory,
        projectLedgers,
      );
      const me = createMeService(db, directory);
      const proposals = createProposalsService(db, directory);
      const tokens = createTokensService(db);
      const treasury = createTreasuryService(directory, projectLedgers);
      const nearn = createNearnService();

      yield* Effect.logInfo(`[API] plugins.projects available: ${typeof plugins?.projects}`);
      yield* Effect.logInfo("[API] Services Initialized");
      return {
        db,
        access,
        applications,
        contactForm,
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
    const {
      db,
      access,
      applications,
      contactForm,
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
    const { member, manager, defaultOrganizationMember, defaultOrganizationManager } =
      access.middleware(builder);

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      })),

      contact: {
        submit: builder.contact.submit.handler(async ({ input }) =>
          runEffect(contactForm.submit(input)),
        ),
      },

      applications: {
        create: builder.applications.create.handler(async ({ input }) =>
          runEffect(applications.create(input)),
        ),

        list: builder.applications.list
          .use(defaultOrganizationMember)
          .handler(async ({ input }) => runEffect(applications.list(input))),

        update: builder.applications.update
          .use(defaultOrganizationManager)
          .handler(async ({ context, input }) =>
            runEffect(
              applications.update({ near: { primaryAccountId: context.scope.actorId } }, input),
            ),
          ),

        convertToBuilder: builder.applications.convertToBuilder
          .use(defaultOrganizationManager)
          .handler(async ({ context, input }) => {
            return runEffect(applications.convertToBuilder(context.scope, input));
          }),
      },

      agency: {
        projects: {
          list: builder.agency.projects.list.handler(async ({ context }) =>
            runEffect(agency.listProjects(await access.publicScope(context))),
          ),

          get: builder.agency.projects.get
            .use(auth.requireOrganization)
            .handler(async ({ context, input }) =>
              runEffect(agency.getProject(await access.publicScope(context), input.slug)),
            ),

          getBudget: builder.agency.projects.getBudget
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(agency.getBudget(context.scope, input.projectId)),
            ),

          create: builder.agency.projects.create
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(agency.createProject(context.scope, input)),
            ),

          update: builder.agency.projects.update
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(agency.updateProject(context.scope, input)),
            ),

          delete: builder.agency.projects.delete
            .use(manager)
            .handler(async ({ context, input }) =>
              runEffect(agency.deleteProject(context.scope, input)),
            ),
        },

        listings: {
          get: builder.agency.listings.get
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(listings.getInternal(context.scope, input.projectId)),
            ),

          create: builder.agency.listings.create
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(listings.createInternal(context.scope, input)),
            ),

          update: builder.agency.listings.update
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(listings.updateInternal(context.scope, input)),
            ),

          delete: builder.agency.listings.delete
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(listings.deleteInternal(context.scope, input.projectId)),
            ),
        },

        reports: {
          generate: builder.agency.reports.generate
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(reports.generate(context.scope, input)),
            ),
        },
      },

      clients: {
        list: builder.clients.list
          .use(manager)
          .handler(async ({ context }) => runEffect(clients.list(context.scope))),

        get: builder.clients.get
          .use(member)
          .handler(async ({ context, input }) => runEffect(clients.get(context.scope, input.id))),

        lookupByNearAccount: builder.clients.lookupByNearAccount
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => ({
            memberships: await runEffect(access.clientMemberships(context, input.nearAccountId)),
          })),

        create: builder.clients.create
          .use(manager)
          .handler(async ({ context, input }) => runEffect(clients.create(context.scope, input))),

        update: builder.clients.update
          .use(manager)
          .handler(async ({ context, input }) => runEffect(clients.update(context.scope, input))),

        delete: builder.clients.delete
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(clients.delete(context.scope, input.id)),
          ),
      },

      clientPortal: {
        dashboard: {
          summary: builder.clientPortal.dashboard.summary
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.dashboardSummary(context, input)),
            ),
        },

        projects: {
          list: builder.clientPortal.projects.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.listProjects(context, input)),
            ),

          get: builder.clientPortal.projects.get
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.getProject(context, input)),
            ),

          getBudget: builder.clientPortal.projects.getBudget
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.getBudget(context, input)),
            ),
        },

        billings: {
          list: builder.clientPortal.billings.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.listBillings(context, input)),
            ),
        },

        reports: {
          generate: builder.clientPortal.reports.generate
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.generateReport(context, input)),
            ),
        },
      },

      contributors: {
        list: builder.contributors.list.use(member).handler(async ({ context }) => {
          return runEffect(contributors.list(context.scope.pluginContext));
        }),

        get: builder.contributors.get.use(member).handler(async ({ context, input }) => {
          return runEffect(contributors.get(context.scope.pluginContext, input.nearAccount));
        }),

        create: builder.contributors.create.use(manager).handler(async ({ context, input }) => {
          return runEffect(contributors.create(context.scope.pluginContext, input));
        }),

        update: builder.contributors.update.use(manager).handler(async ({ context, input }) => {
          return runEffect(contributors.update(context.scope.pluginContext, input));
        }),
      },

      assignments: {
        list: builder.assignments.list
          .use(member)
          .handler(async ({ context, input }) =>
            runEffect(assignments.list(context.scope, input.projectId)),
          ),

        listAll: builder.assignments.listAll
          .use(member)
          .handler(async ({ context }) => runEffect(assignments.listAll(context.scope))),

        create: builder.assignments.create
          .use(member)
          .handler(async ({ context, input }) =>
            runEffect(assignments.create(context.scope, input)),
          ),

        delete: builder.assignments.delete
          .use(member)
          .handler(async ({ context, input }) =>
            runEffect(assignments.delete(context.scope, input)),
          ),
      },

      budgets: {
        list: builder.budgets.list
          .use(member)
          .handler(async ({ context, input }) => runEffect(budgets.list(context.scope, input))),

        create: builder.budgets.create
          .use(manager)
          .handler(async ({ context, input }) => runEffect(budgets.create(context.scope, input))),

        deallocate: builder.budgets.deallocate
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(budgets.deallocate(context.scope, input)),
          ),

        transfer: builder.budgets.transfer
          .use(manager)
          .handler(async ({ context, input }) => runEffect(budgets.transfer(context.scope, input))),
      },

      billings: {
        list: builder.billings.list
          .use(member)
          .handler(async ({ context, input }) => runEffect(billings.list(context.scope, input))),

        create: builder.billings.create
          .use(manager)
          .handler(async ({ context, input }) => runEffect(billings.create(context.scope, input))),

        delete: builder.billings.delete
          .use(manager)
          .handler(async ({ context, input }) => runEffect(billings.delete(context.scope, input))),
      },

      proposals: {
        list: builder.proposals.list.handler(async ({ context, input }) =>
          runEffect(proposals.list(await access.publicScope(context), input)),
        ),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) =>
          runEffect(proposals.getPublicSummary(await access.publicScope(context))),
        ),
      },

      nearn: {
        getListing: builder.nearn.getListing
          .use(member)
          .handler(async ({ context, input }) => runEffect(nearn.getListing(context.scope, input))),

        listSponsorBounties: builder.nearn.listSponsorBounties
          .use(member)
          .handler(async ({ context }) => runEffect(nearn.listSponsorBounties(context.scope))),

        listSubmissions: builder.nearn.listSubmissions
          .use(member)
          .handler(async ({ context, input }) =>
            runEffect(nearn.listSubmissions(context.scope, input)),
          ),
      },

      tokens: {
        list: builder.tokens.list.handler(async ({ context }) =>
          runEffect(tokens.list(await access.publicScope(context))),
        ),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) =>
          runEffect(tokens.getStorageStatus(await access.publicScope(context), input)),
        ),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(async ({ context, input }) =>
          runEffect(treasury.getPublicBalances(await access.publicScope(context), input)),
        ),

        getBalances: builder.treasury.getBalances
          .use(member)
          .handler(async ({ context, input }) =>
            runEffect(treasury.getBalances(context.scope, input)),
          ),

        getRollups: builder.treasury.getRollups
          .use(member)
          .handler(async ({ context }) => runEffect(treasury.getRollups(context.scope))),

        getPublicSummary: builder.treasury.getPublicSummary.handler(async ({ context }) =>
          runEffect(treasury.getPublicSummary(await access.publicScope(context))),
        ),
      },

      me: {
        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const { role, capabilities } = await access.resolve(context);
          return {
            orgRole: role === "admin" || role === "member" || role === "owner" ? role : null,
            capabilities,
          };
        }),

        assignedProjects: builder.me.assignedProjects.use(member).handler(async ({ context }) => {
          const nearAccount = context.near?.primaryAccountId as string | undefined;
          if (!nearAccount) {
            throw new ORPCError("FORBIDDEN", {
              message: "Link a NEAR wallet to view assigned projects",
            });
          }
          return runEffect(me.assignedProjects(context.scope, nearAccount));
        }),
      },

      team: {
        list: builder.team.list.handler(async ({ context }) => {
          const { agencyDao } = await access.publicScope(context);
          try {
            return { roles: await getRoles(agencyDao) };
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
          .use(manager)
          .handler(async ({ context }) =>
            getAdminSettings(db, context.scope.agencyDao, getNetwork(context.reqHeaders)),
          ),

        update: builder.agencyConfig.update.use(manager).handler(async ({ context, input }) => {
          const { agencyDao, actorId } = context.scope;
          await upsertSettings(
            db,
            agencyDao,
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
