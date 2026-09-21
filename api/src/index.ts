import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive, DatabaseTag } from "./db/layer";
import { createAgencyRoleMiddleware } from "./lib/agency-scope";
import { createAuthMiddleware } from "./lib/auth";
import { createAuthOrganizations } from "./lib/auth-organizations";
import { ContextSchema, runEffect } from "./lib/context";
import { getNetwork, pinnedNetwork } from "./lib/network";
import { setDefaultDaoAccountId } from "./lib/org";
import { createOrganizationAccess } from "./lib/organization-access";
import type { PluginsClient } from "./lib/plugins-types.gen";
import { createAgencyService } from "./services/agency";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createChangeOrdersService } from "./services/change-orders";
import { createClientPortalService } from "./services/client-portal";
import { createClientsService } from "./services/clients";
import { createContactFormService } from "./services/contact-form";
import { createContributorsService } from "./services/contributors";
import { createEngagementsService } from "./services/engagements";
import { createProjectLedgers } from "./services/ledger";
import { createListingsService } from "./services/listings";
import { createMeService } from "./services/me";
import { createNearnService } from "./services/nearn";
import { notifyWebhook } from "./services/notify";
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

      const organizations = createAuthOrganizations(plugins.auth);
      const access = createOrganizationAccess(db, organizations);
      const directory = createProjectDirectory((pluginContext) => plugins.projects(pluginContext));
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
      const engagements = createEngagementsService(db, directory, organizations);
      const changeOrders = createChangeOrdersService(db, {
        engagements,
        directory,
        ledgers: projectLedgers,
        access,
        notify: (event) =>
          notifyWebhook(notifyConfig.webhookUrl, `[${event.to}] ${event.message}`, {
            event,
          }),
      });
      const prepayments = createPrepaymentsService(db, engagements, changeOrders.applyPeriod);
      const clientPortal = createClientPortalService(
        engagements,
        agency,
        billings,
        reports,
        directory,
        projectLedgers,
        access,
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
        engagements,
        prepayments,
        changeOrders,
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
      engagements,
      prepayments,
      changeOrders,
      clientPortal,
      me,
      proposals,
      tokens,
      treasury,
      nearn,
    } = services;
    const auth = createAuthMiddleware(builder);
    const { member, manager, orgMember, orgManager } = createAgencyRoleMiddleware(
      builder,
      access.scope,
      access.orgScope,
    );

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
          .use(member)
          .handler(async ({ input }) => runEffect(applications.list(input))),

        update: builder.applications.update
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(
              applications.update({ near: { primaryAccountId: context.scope.actorId } }, input),
            ),
          ),

        convertToBuilder: builder.applications.convertToBuilder
          .use(manager)
          .handler(async ({ context, input }) => {
            return runEffect(applications.convertToBuilder(context.scope, input));
          }),
      },

      agency: {
        projects: {
          list: builder.agency.projects.list.handler(async ({ context }) =>
            runEffect(agency.listProjects(await access.orgScope(context))),
          ),

          get: builder.agency.projects.get
            .use(auth.requireOrganization)
            .handler(async ({ context, input }) =>
              runEffect(agency.getProject(await access.orgScope(context), input.slug)),
            ),

          getBudget: builder.agency.projects.getBudget
            .use(member)
            .handler(async ({ context, input }) =>
              runEffect(agency.getBudget(context.scope, input.projectId)),
            ),

          create: builder.agency.projects.create
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.createProject(context.scope, input)),
            ),

          update: builder.agency.projects.update
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.updateProject(context.scope, input)),
            ),

          delete: builder.agency.projects.delete
            .use(orgManager)
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
            memberships: await runEffect(clients.membershipsFor(context, input.nearAccountId)),
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

      engagements: {
        list: builder.engagements.list
          .use(orgMember)
          .handler(async ({ context }) => runEffect(engagements.list(context.scope))),

        createClient: builder.engagements.createClient
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.createClient(context.scope, input)),
          ),

        propose: builder.engagements.propose
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.propose(context.scope, input)),
          ),

        accept: builder.engagements.accept
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.accept(context.scope, input.id)),
          ),

        decline: builder.engagements.decline
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.decline(context.scope, input.id)),
          ),

        end: builder.engagements.end
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.end(context.scope, input.id)),
          ),

        share: builder.engagements.share
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.share(context.scope, input)),
          ),

        unshare: builder.engagements.unshare
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(engagements.unshare(context.scope, input)),
          ),
      },

      prepayments: {
        list: builder.prepayments.list
          .use(orgMember)
          .handler(async ({ context, input }) =>
            runEffect(prepayments.list(context.scope, input.engagementId)),
          ),

        record: builder.prepayments.record
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(prepayments.record(context.scope, input)),
          ),

        correct: builder.prepayments.correct
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(prepayments.correct(context.scope, input)),
          ),

        remove: builder.prepayments.remove
          .use(manager)
          .handler(async ({ context, input }) =>
            runEffect(prepayments.remove(context.scope, input.id)),
          ),
      },

      changeOrders: {
        list: builder.changeOrders.list
          .use(orgMember)
          .handler(async ({ context, input }) =>
            runEffect(changeOrders.list(context.scope, input.engagementId)),
          ),

        plan: builder.changeOrders.plan.use(orgMember).handler(async ({ context, input }) => ({
          plan: await runEffect(changeOrders.plan(context.scope, input.engagementId)),
        })),

        propose: builder.changeOrders.propose
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(changeOrders.propose(context.scope, input)),
          ),

        approve: builder.changeOrders.approve
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(changeOrders.approve(context.scope, input.id)),
          ),

        reject: builder.changeOrders.reject
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(changeOrders.reject(context.scope, input.id)),
          ),

        withdraw: builder.changeOrders.withdraw
          .use(orgManager)
          .handler(async ({ context, input }) =>
            runEffect(changeOrders.withdraw(context.scope, input.id)),
          ),
      },

      clientPortal: {
        dashboard: {
          summary: builder.clientPortal.dashboard.summary
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.dashboardSummary(context.scope, input)),
            ),
        },

        projects: {
          list: builder.clientPortal.projects.list
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.listProjects(context.scope, input)),
            ),

          get: builder.clientPortal.projects.get
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.getProject(context.scope, input)),
            ),

          getBudget: builder.clientPortal.projects.getBudget
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.getBudget(context.scope, input)),
            ),
        },

        billings: {
          list: builder.clientPortal.billings.list
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.listBillings(context.scope, input)),
            ),
        },

        reports: {
          generate: builder.clientPortal.reports.generate
            .use(orgMember)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.generateReport(context.scope, input)),
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
          .use(orgMember)
          .handler(async ({ context, input }) =>
            runEffect(assignments.list(context.scope, input.projectId)),
          ),

        listAll: builder.assignments.listAll
          .use(orgMember)
          .handler(async ({ context }) => runEffect(assignments.listAll(context.scope))),

        create: builder.assignments.create
          .use(orgMember)
          .handler(async ({ context, input }) =>
            runEffect(assignments.create(context.scope, input)),
          ),

        delete: builder.assignments.delete
          .use(orgMember)
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
          runEffect(proposals.list(await access.scope(context), input)),
        ),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) =>
          runEffect(proposals.getPublicSummary(await access.scope(context))),
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
          runEffect(tokens.list(await access.scope(context))),
        ),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) =>
          runEffect(tokens.getStorageStatus(await access.scope(context), input)),
        ),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(async ({ context, input }) =>
          runEffect(treasury.getPublicBalances(await access.scope(context), input)),
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
          runEffect(treasury.getPublicSummary(await access.scope(context))),
        ),
      },

      me: {
        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const scope = await access.orgScope(context).catch(() => null);
          const role = scope?.role ?? null;
          return {
            orgRole: role === "admin" || role === "member" || role === "owner" ? role : null,
            hasAgencyDao: role !== null && scope?.agencyDao != null,
          };
        }),

        assignedProjects: builder.me.assignedProjects
          .use(orgMember)
          .handler(async ({ context }) => {
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
          const { agencyDao } = await access.scope(context);
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
