import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import pg from "pg";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAuthMiddleware } from "./lib/auth";
import { authDatabaseDirectory } from "./lib/auth-database";
import { ContextSchema, runEffect } from "./lib/context";
import { getNetwork, pinnedNetwork } from "./lib/network";
import {
  betterAuthOrganizations,
  nearAccountsOf,
  type PluginContext,
  unconfiguredDirectory,
} from "./lib/organizations";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { createAgencyService } from "./services/agency";
import { createAgencyDaoService } from "./services/agency-dao";
import { createAgentLinksService } from "./services/agent-links";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createChangeOrdersService } from "./services/change-orders";
import { createClientPortalService } from "./services/client-portal";
import { createContactFormService } from "./services/contact-form";
import { createContributorsService } from "./services/contributors";
import { createEngagementsService } from "./services/engagements";
import { createIdeasService } from "./services/ideas";
import { createProjectLedgers } from "./services/ledger";
import { createListingsService } from "./services/listings";
import { createMeService } from "./services/me";
import { createNearnService } from "./services/nearn";
import { createNotifications } from "./services/notifications";
import { resendEmailSender } from "./services/notify";
import { createOrganizationAccess, ROLE_MATRIX } from "./services/organization-access";
import { createPrepaymentsService } from "./services/prepayments";
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
    appOrigin: z.string().url().default("https://dev.multiagency.ai"),
  }),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("pglite:.bos/api/:memory:"),
    AUTH_DATABASE_URL: z.string().optional(),
    APPLICATIONS_WEBHOOK_URL: z.string().optional(),
    CONTACT_FORM_WEBHOOK_URL: z.string().optional(),
    CONTACT_FORM_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    NOTIFY_FROM_EMAIL: z.string().optional(),
    APP_ORIGIN: z.string().url().optional(),
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
      const authDatabaseUrl = config.secrets.AUTH_DATABASE_URL;
      const authPool = authDatabaseUrl ? new pg.Pool({ connectionString: authDatabaseUrl }) : null;
      const organizationDirectory = authPool
        ? authDatabaseDirectory(authPool)
        : unconfiguredDirectory();
      const appOrigin = config.secrets.APP_ORIGIN ?? config.variables.appOrigin;
      const sendEmail = resendEmailSender({
        resendApiKey: config.secrets.RESEND_API_KEY,
        fromEmail: config.secrets.NOTIFY_FROM_EMAIL,
      });
      const notifications = createNotifications({
        db,
        directory: organizationDirectory,
        sendEmail,
        appOrigin,
      });
      const access = createOrganizationAccess({
        db,
        organizations: betterAuthOrganizations(() => plugins.auth()),
        directory,
        defaultDaoAccountId: config.variables.agencyDaoAccount,
      });
      const agencyDaos = createAgencyDaoService({ db, directory, daoRoles: getRoles });
      const listings = createListingsService(db, directory);
      const projectLedgers = createProjectLedgers(db, listings);
      const agency = createAgencyService(db, plugins, directory, listings, projectLedgers);
      const contributors = createContributorsService(db, plugins);
      const applications = createApplicationsService(db, notifyConfig, contributors);
      const contactForm = createContactFormService({
        webhookUrl: config.secrets.CONTACT_FORM_WEBHOOK_URL,
        webhookSecret: config.secrets.CONTACT_FORM_WEBHOOK_SECRET,
      });
      const assignments = createAssignmentsService(db, directory, access, organizationDirectory);
      const budgets = createBudgetsService(db, directory);
      const billings = createBillingsService(db, directory, access);
      const reports = createReportsService(db, directory, plugins, organizationDirectory);
      const changeOrders = createChangeOrdersService({
        db,
        organizations: organizationDirectory,
        notifications,
      });
      const engagements = createEngagementsService({
        db,
        organizations: organizationDirectory,
        projects: directory,
        notifications,
        sendEmail,
        appOrigin,
        subcontracted: access.subcontractedProjects,
        onEnded: changeOrders.withdrawPending,
      });
      const prepayments = createPrepaymentsService({
        db,
        organizations: organizationDirectory,
        notifications,
        onPlanApplied: changeOrders.notifyPlanApplied,
      });
      const ideas = createIdeasService({
        db,
        agency,
        directory,
        readScopeOfAgency: access.readScopeOfAgency,
        engagements,
        notifications,
        organizations: organizationDirectory,
      });
      const agentLinks = createAgentLinksService({ db });
      const clientPortal = createClientPortalService(
        access,
        agency,
        billings,
        reports,
        directory,
        projectLedgers,
      );
      const me = createMeService({
        db,
        directory,
        organizations: organizationDirectory,
        readScopeOf: access.readScopeOfAgency,
      });
      const proposals = createProposalsService(db, directory);
      const tokens = createTokensService(db);
      const treasury = createTreasuryService(directory, projectLedgers);
      const nearn = createNearnService();

      yield* Effect.logInfo(`[API] plugins.projects available: ${typeof plugins?.projects}`);
      yield* Effect.logInfo("[API] Services Initialized");
      return {
        db,
        access,
        agencyDaos,
        applications,
        contactForm,
        agency,
        listings,
        contributors,
        engagements,
        prepayments,
        changeOrders,
        ideas,
        agentLinks,
        notifications,
        organizationDirectory,
        authPool,
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

  shutdown: (services) =>
    Effect.gen(function* () {
      if (services.authPool) yield* Effect.promise(() => services.authPool!.end());
      yield* Effect.logInfo("[API] Shutdown");
    }),

  createRouter: (services, builder) => {
    const {
      db,
      access,
      agencyDaos,
      applications,
      contactForm,
      agency,
      listings,
      contributors,
      engagements,
      prepayments,
      changeOrders,
      ideas,
      agentLinks,
      notifications,
      organizationDirectory,
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
    const {
      member,
      manager,
      treasuryMember,
      treasuryManager,
      defaultOrganizationMember,
      defaultOrganizationManager,
    } = access.middleware(builder);

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

          listOwned: builder.agency.projects.listOwned
            .use(member)
            .handler(async ({ context }) => runEffect(agency.listProjects(context.scope))),

          get: builder.agency.projects.get
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(agency.getProject(context.scope, input.slug)),
            ),

          getBudget: builder.agency.projects.getBudget
            .use(treasuryMember)
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

      engagements: {
        list: builder.engagements.list
          .use(member)
          .handler(async ({ context }) => engagements.list(context.scope)),

        get: builder.engagements.get
          .use(member)
          .handler(async ({ context, input }) => engagements.get(context.scope, input.id)),

        createWithClient: builder.engagements.createWithClient
          .use(manager)
          .handler(async ({ context, input }) =>
            engagements.createWithClient(context.scope, input),
          ),

        subcontract: builder.engagements.subcontract
          .use(manager)
          .handler(async ({ context, input }) => engagements.subcontract(context.scope, input)),

        sharedWithUs: builder.engagements.sharedWithUs
          .use(member)
          .handler(async ({ context }) => engagements.sharedWithUs(context.scope)),

        propose: builder.engagements.propose
          .use(manager)
          .handler(async ({ context, input }) => engagements.propose(context.scope, input)),

        accept: builder.engagements.accept
          .use(manager)
          .handler(async ({ context, input }) => engagements.accept(context.scope, input.id)),

        decline: builder.engagements.decline
          .use(manager)
          .handler(async ({ context, input }) => engagements.decline(context.scope, input.id)),

        end: builder.engagements.end
          .use(manager)
          .handler(async ({ context, input }) => engagements.end(context.scope, input.id)),

        share: builder.engagements.share
          .use(manager)
          .handler(async ({ context, input }) => engagements.share(context.scope, input)),

        unshare: builder.engagements.unshare
          .use(manager)
          .handler(async ({ context, input }) => engagements.unshare(context.scope, input)),

        invitation: {
          resend: builder.engagements.invitation.resend
            .use(manager)
            .handler(async ({ context, input }) =>
              engagements.resendInvitation(context.scope, input.id),
            ),

          cancel: builder.engagements.invitation.cancel
            .use(manager)
            .handler(async ({ context, input }) =>
              engagements.cancelInvitation(context.scope, input.id),
            ),

          changeEmail: builder.engagements.invitation.changeEmail
            .use(manager)
            .handler(async ({ context, input }) =>
              engagements.changeInvitationEmail(context.scope, input.id, input.email),
            ),
        },
      },

      prepayments: {
        list: builder.prepayments.list
          .use(member)
          .handler(async ({ context, input }) => prepayments.list(context.scope, input)),

        balance: builder.prepayments.balance
          .use(member)
          .handler(async ({ context, input }) => prepayments.balance(context.scope, input)),

        record: builder.prepayments.record
          .use(manager)
          .handler(async ({ context, input }) => prepayments.record(context.scope, input)),

        correct: builder.prepayments.correct
          .use(manager)
          .handler(async ({ context, input }) => prepayments.correct(context.scope, input)),

        remove: builder.prepayments.remove
          .use(manager)
          .handler(async ({ context, input }) => prepayments.remove(context.scope, input)),
      },

      changeOrders: {
        list: builder.changeOrders.list
          .use(member)
          .handler(async ({ context, input }) => changeOrders.list(context.scope, input)),

        awaiting: builder.changeOrders.awaiting
          .use(member)
          .handler(async ({ context }) => changeOrders.awaiting(context.scope)),

        plan: builder.changeOrders.plan
          .use(member)
          .handler(async ({ context, input }) => changeOrders.plan(context.scope, input)),

        propose: builder.changeOrders.propose
          .use(manager)
          .handler(async ({ context, input }) => changeOrders.propose(context.scope, input)),

        withdraw: builder.changeOrders.withdraw
          .use(manager)
          .handler(async ({ context, input }) => changeOrders.withdraw(context.scope, input)),

        approve: builder.changeOrders.approve
          .use(manager)
          .handler(async ({ context, input }) => changeOrders.approve(context.scope, input)),

        reject: builder.changeOrders.reject
          .use(manager)
          .handler(async ({ context, input }) => changeOrders.reject(context.scope, input)),
      },

      ideas: {
        list: builder.ideas.list
          .use(member)
          .handler(async ({ context, input }) => ideas.list(context.scope, input)),

        submit: builder.ideas.submit
          .use(member)
          .handler(async ({ context, input }) => ideas.submit(context.scope, input)),

        accept: builder.ideas.accept
          .use(manager)
          .handler(async ({ context, input }) => ideas.accept(context.scope, input)),

        decline: builder.ideas.decline
          .use(manager)
          .handler(async ({ context, input }) => ideas.decline(context.scope, input)),
      },

      agentLinks: {
        list: builder.agentLinks.list
          .use(member)
          .handler(async ({ context, input }) => agentLinks.list(context.scope, input)),

        create: builder.agentLinks.create
          .use(manager)
          .handler(async ({ context, input }) => agentLinks.create(context.scope, input)),

        update: builder.agentLinks.update
          .use(manager)
          .handler(async ({ context, input }) => agentLinks.update(context.scope, input)),

        reorder: builder.agentLinks.reorder
          .use(manager)
          .handler(async ({ context, input }) => agentLinks.reorder(context.scope, input)),

        remove: builder.agentLinks.remove
          .use(manager)
          .handler(async ({ context, input }) => agentLinks.remove(context.scope, input)),
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

      notifications: {
        list: builder.notifications.list
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => notifications.list(context.userId, input)),

        unreadCount: builder.notifications.unreadCount
          .use(auth.requireAuth)
          .handler(async ({ context }) => notifications.unreadCount(context.userId)),

        markRead: builder.notifications.markRead
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => notifications.markRead(context.userId, input)),
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
          .use(treasuryMember)
          .handler(async ({ context, input }) => runEffect(budgets.list(context.scope, input))),

        create: builder.budgets.create
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(budgets.create(context.scope, input))),

        deallocate: builder.budgets.deallocate
          .use(treasuryManager)
          .handler(async ({ context, input }) =>
            runEffect(budgets.deallocate(context.scope, input)),
          ),

        transfer: builder.budgets.transfer
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(budgets.transfer(context.scope, input))),
      },

      billings: {
        list: builder.billings.list
          .use(treasuryMember)
          .handler(async ({ context, input }) => runEffect(billings.list(context.scope, input))),

        create: builder.billings.create
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(billings.create(context.scope, input))),

        delete: builder.billings.delete
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(billings.delete(context.scope, input))),
      },

      proposals: {
        list: builder.proposals.list.handler(async ({ context, input }) =>
          runEffect(proposals.list(await access.publicTreasuryScope(context), input)),
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

        listOwned: builder.tokens.listOwned
          .use(treasuryMember)
          .handler(async ({ context }) => runEffect(tokens.list(context.scope))),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) =>
          runEffect(tokens.getStorageStatus(await access.publicScope(context), input)),
        ),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(async ({ context, input }) =>
          runEffect(treasury.getPublicBalances(await access.publicScope(context), input)),
        ),

        getBalances: builder.treasury.getBalances
          .use(treasuryMember)
          .handler(async ({ context, input }) =>
            runEffect(treasury.getBalances(context.scope, input)),
          ),

        getRollups: builder.treasury.getRollups
          .use(treasuryMember)
          .handler(async ({ context }) => runEffect(treasury.getRollups(context.scope))),

        getPublicSummary: builder.treasury.getPublicSummary.handler(async ({ context }) =>
          runEffect(treasury.getPublicSummary(await access.publicScope(context))),
        ),
      },

      me: {
        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const { role, agencyDao, capabilities } = await access.resolve(context);
          return {
            orgRole: role === "admin" || role === "member" || role === "owner" ? role : null,
            agencyDao,
            capabilities,
          };
        }),

        assignedProjects: builder.me.assignedProjects
          .use(auth.requireAuth)
          .handler(async ({ context }) => me.assignedProjects(context)),

        billings: builder.me.billings
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => me.billings(context, input)),

        organizations: builder.me.organizations
          .use(auth.requireAuth)
          .handler(async ({ context }) => {
            const memberships = await organizationDirectory.memberships(context.userId);
            return {
              data: memberships
                .filter((m) => !m.organization.isPersonal)
                .map((m) => ({
                  id: m.organization.id,
                  name: m.organization.name,
                  slug: m.organization.slug,
                  role: m.role === "contributor" ? null : m.role,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            };
          }),
      },

      agencyDao: {
        get: builder.agencyDao.get
          .use(manager)
          .handler(async ({ context }) => agencyDaos.status(context.scope)),

        connect: builder.agencyDao.connect
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const network = getNetwork(context.reqHeaders);
            if (input.organizationId) {
              if (context.user.role !== "admin") {
                throw new ORPCError("FORBIDDEN", {
                  message: "Only platform admins can connect a DAO to another Organization",
                });
              }
              return agencyDaos.connectAsPlatformAdmin(
                input.organizationId,
                input.daoAccountId,
                network,
              );
            }
            const scope = await access.agencyScope(context, ROLE_MATRIX.manage);
            return agencyDaos.connectForMember(scope, {
              daoAccountId: input.daoAccountId,
              network,
              walletAccounts: nearAccountsOf(context as PluginContext),
            });
          }),

        disconnect: builder.agencyDao.disconnect
          .use(manager)
          .handler(async ({ context }) => agencyDaos.disconnect(context.scope)),
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
          const resolved = await getResolvedPublicSettings(
            db,
            network,
            await access.defaultOrganization(),
          );
          return {
            ...resolved,
            network,
            networkPinned: pinnedNetwork() !== null,
          };
        }),

        get: builder.agencyConfig.get
          .use(manager)
          .handler(async ({ context }) =>
            getAdminSettings(db, context.scope, getNetwork(context.reqHeaders)),
          ),

        update: builder.agencyConfig.update.use(manager).handler(async ({ context, input }) => {
          const { organizationId, actorId } = context.scope;
          await upsertSettings(
            db,
            organizationId,
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
