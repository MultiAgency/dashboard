import { timingSafeEqual } from "node:crypto";
import { AgentApi } from "@near-intents-agent-api/sdk";
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
import { agreementsOfEngagement, createAgreementsService } from "./services/agreements";
import { createApplicationsService } from "./services/applications";
import { createAssignmentsService } from "./services/assignments";
import { createBillingsService } from "./services/billings";
import { createBudgetsService } from "./services/budgets";
import { createChangeOrdersService } from "./services/change-orders";
import { createClientPortalService } from "./services/client-portal";
import { createCommunityService } from "./services/community";
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
import {
  agencyDaoOf,
  createOrganizationAccess,
  hasRole,
  type OrganizationScope,
  ROLE_MATRIX,
} from "./services/organization-access";
import { atomicToNear, nearToAtomic, topUpFor } from "./services/payouts/policy";
import { type AgentApiPort, createPayoutAgents, workOrderPayees } from "./services/payouts/service";
import { createPrepaymentsService } from "./services/prepayments";
import { createProjectDirectory } from "./services/project-directory";
import { createProposalsService } from "./services/proposals";
import { createReportsService, type ReportViewer } from "./services/reports";
import {
  getAdminSettings,
  getResolvedPublicSettings,
  upsertSettings,
} from "./services/settings-admin";
import { fullAccessKeys, getProposal, getProposalBond, getRoles } from "./services/sputnik";
import { createTokensService } from "./services/tokens";
import { createTreasuryService } from "./services/treasury";
import { createConsistencyChecker } from "./services/work-orders/consistency";
import { createDocumenso } from "./services/work-orders/documenso";
import { cachedOwnership, createGitHub } from "./services/work-orders/github";
import {
  createGoogle,
  googleIdOf,
  parseServiceAccount,
  readServiceAccount,
} from "./services/work-orders/google";
import { createWorkOrderIntegrations, createWorkOrderOutbox } from "./services/work-orders/outbox";
import { createPriceFeed } from "./services/work-orders/prices";
import { scheduleWorkOrders, stopWorkOrders } from "./services/work-orders/scheduler";
import { createWorkOrdersService } from "./services/work-orders/service";
import { createSummarizer } from "./services/work-orders/summarizer";
import { isTimeZone, UTC } from "./services/work-orders/time";
import { DEFAULT_RENEWAL } from "./services/work-orders/types";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    agencyDaoAccount: z.string().optional(),
    appOrigin: z.string().url().default("https://dev.multiagency.ai"),
    communityApiUrl: z.string().url().default("https://nearbuilders.org/api"),
    workOrderRenewal: z
      .object({
        minActiveWeeksPct: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(DEFAULT_RENEWAL.minActiveWeeksPct),
        minApprovedPrs: z.number().int().min(0).default(DEFAULT_RENEWAL.minApprovedPrs),
        minIssuesDonePct: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(DEFAULT_RENEWAL.minIssuesDonePct),
        maxUnapprovedPrs: z.number().int().min(0).default(DEFAULT_RENEWAL.maxUnapprovedPrs),
      })
      .default(DEFAULT_RENEWAL),
    workOrderTimezone: z
      .string()
      .refine(isTimeZone, "Use an IANA time zone, e.g. Asia/Karachi")
      .default(UTC),
    workOrderSchedule: z
      .object({
        tickSeconds: z.number().int().min(0).default(15),
        runMinutes: z.number().int().min(0).default(360),
        firstRunSeconds: z.number().int().min(0).default(30),
      })
      .default({ tickSeconds: 15, runMinutes: 360, firstRunSeconds: 30 }),
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
    GITHUB_TOKEN: z.string().optional(),
    WORK_ORDERS_RUN_SECRET: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
    NEAR_INTENTS_AGENT_API_KEY: z.string().optional(),
    NEAR_INTENTS_AGENT_API_URL: z.string().optional(),
    DOCUMENSO_API_KEY: z.string().optional(),
    DOCUMENSO_API_URL: z.string().optional(),
    PAYOUTS_SECRET_KEY: z.string().optional(),
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
      const reports = createReportsService(
        db,
        directory,
        plugins,
        organizationDirectory,
        notifications,
      );
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
      const agreements = createAgreementsService(db);
      const clientPortal = createClientPortalService(
        access,
        agency,
        billings,
        reports,
        directory,
        projectLedgers,
        (engagementId) => agreementsOfEngagement(db, engagementId),
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
      const community = createCommunityService(config.variables.communityApiUrl);
      const github = createGitHub(config.secrets.GITHUB_TOKEN ?? null);
      const workOrderIntegrations = createWorkOrderIntegrations({ db });
      const workOrderOutbox = createWorkOrderOutbox({
        db,
        sendEmail,
        immediate: true,
      });
      const workOrderAiDrafts = !!config.secrets.ANTHROPIC_API_KEY;
      const serviceAccount = parseServiceAccount(
        readServiceAccount(config.secrets.GOOGLE_SERVICE_ACCOUNT_JSON),
      );
      const google = serviceAccount ? createGoogle(serviceAccount) : null;
      const agentApiKey = config.secrets.NEAR_INTENTS_AGENT_API_KEY;
      const payoutAgents = createPayoutAgents({
        db,
        api: agentApiKey
          ? (new AgentApi({
              apiKey: agentApiKey,
              ...(config.secrets.NEAR_INTENTS_AGENT_API_URL
                ? { baseUrl: config.secrets.NEAR_INTENTS_AGENT_API_URL }
                : {}),
              timeoutMs: 180_000,
            }) as unknown as AgentApiPort)
          : null,
        secretKey: config.secrets.PAYOUTS_SECRET_KEY ?? null,
        payees: workOrderPayees(db),
        fullAccessKeys,
      });
      const userEmail = async (userId: string) => {
        if (!authPool) return null;
        const { rows } = await authPool.query<{ email: string | null }>(
          'SELECT email FROM "user" WHERE id = $1 LIMIT 1',
          [userId],
        );
        return rows[0]?.email ?? null;
      };
      const workOrders = createWorkOrdersService({
        db,
        directory,
        scopeOfOrganization: (organizationId) =>
          access.readScopeOfAgency({ userId: "system:work-orders" }, organizationId),
        agencyDaoOf: (organizationId) => agencyDaoOf(db, organizationId),
        organizationName: async (organizationId) =>
          (await organizationDirectory.get(organizationId))?.name ?? organizationId,
        builders: {
          get: async (nearAccount) => {
            try {
              const { data } = await plugins.builders({}).getBuilder({ nearAccount });
              return {
                nearAccount: data.nearAccount,
                name: data.name,
                githubLogin: data.githubLogin,
                userId: data.userId,
              };
            } catch {
              return null;
            }
          },
        },
        github,
        ownership: cachedOwnership(github, 10 * 60_000),
        proposal: (daoAccountId, proposalId) => getProposal(db, daoAccountId, proposalId),
        proposalBond: getProposalBond,
        prices: createPriceFeed(),
        esign: config.secrets.DOCUMENSO_API_KEY
          ? createDocumenso({
              apiKey: config.secrets.DOCUMENSO_API_KEY,
              apiUrl: config.secrets.DOCUMENSO_API_URL,
            })
          : null,
        notifications,
        thresholds: config.variables.workOrderRenewal,
        outbox: workOrderOutbox,
        summarizer: createSummarizer(config.secrets.ANTHROPIC_API_KEY),
        consistency: config.secrets.ANTHROPIC_API_KEY
          ? createConsistencyChecker({ apiKey: config.secrets.ANTHROPIC_API_KEY })
          : null,
        payouts: payoutAgents.available ? payoutAgents : null,
        google,
        userEmail,
        appOrigin,
        timeZone: config.variables.workOrderTimezone,
      });
      const workOrderTimers = scheduleWorkOrders(workOrders, config.variables.workOrderSchedule);
      const workOrdersRunSecret = config.secrets.WORK_ORDERS_RUN_SECRET ?? null;

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
        agreements,
        clientPortal,
        me,
        proposals,
        tokens,
        treasury,
        nearn,
        community,
        workOrders,
        workOrdersRunSecret,
        workOrderIntegrations,
        workOrderAiDrafts,
        workOrderEmails: sendEmail !== null,
        google,
        payoutAgents,
        workOrderTimers,
      };
    }),

  shutdown: (services) =>
    Effect.gen(function* () {
      stopWorkOrders(services.workOrderTimers);
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
      agreements,
      clientPortal,
      me,
      proposals,
      tokens,
      treasury,
      nearn,
      community,
      workOrders,
      workOrdersRunSecret,
      workOrderIntegrations,
      workOrderAiDrafts,
      workOrderEmails,
      google,
      payoutAgents,
    } = services;

    const googleUrl = {
      document: (id: string | null) =>
        id ? `https://docs.google.com/document/d/${id}/edit` : null,
      folder: (id: string | null) => (id ? `https://drive.google.com/drive/folders/${id}` : null),
    };

    const checkGoogleFile = async (
      label: string,
      value: string | null,
      kind: "document" | "folder",
      sharedDriveOnly = false,
    ): Promise<string | null> => {
      if (!value) return null;
      const id = googleIdOf(value);
      if (!id) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${label}: paste the Google ${kind === "document" ? "Docs" : "Drive folder"} link`,
          data: { reason: "INVALID_GOOGLE_LINK" },
        });
      }
      if (!google) return id;
      const mime =
        kind === "document"
          ? "application/vnd.google-apps.document"
          : "application/vnd.google-apps.folder";
      try {
        const file = await google.file(id);
        if (file.mimeType !== mime) {
          throw new Error(`it's not a Google ${kind === "document" ? "Doc" : "Drive folder"}`);
        }
        if (sharedDriveOnly && !file.driveId) {
          throw new Error(
            "it's in a My Drive. Use a folder inside a Shared Drive: a service account has no Drive storage of its own, so it can only create the filled documents there",
          );
        }
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${label}: ${error instanceof Error ? error.message : String(error)}`,
          data: { reason: "GOOGLE_ACCESS" },
        });
      }
      return id;
    };

    const integrationView = async (organizationId: string) => {
      const [settings, deliveries] = await Promise.all([
        workOrderIntegrations.settings(organizationId),
        workOrderIntegrations.recent(organizationId),
      ]);
      return {
        emailEnabled: workOrderEmails,
        aiDraftsEnabled: workOrderAiDrafts,
        deliveries: deliveries.map((d) => ({
          id: d.id,
          eventType: d.eventType,
          attempts: d.attempts,
          deliveredAt: d.deliveredAt?.toISOString() ?? null,
          lastError: d.lastError,
          createdAt: d.createdAt.toISOString(),
        })),
        google: {
          available: google !== null,
          serviceAccountEmail: google?.email ?? null,
          templateUrl: googleUrl.document(settings?.googleTemplateId ?? null),
          documentsFolderUrl: googleUrl.folder(settings?.googleDocumentsFolderId ?? null),
          signedFolderUrl: googleUrl.folder(settings?.googleSignedFolderId ?? null),
          checkedAt: settings?.googleCheckedAt?.toISOString() ?? null,
          lastError: settings?.googleLastError ?? null,
          files: (await workOrderIntegrations.driveFiles(organizationId)).map((f) => ({
            fileId: f.fileId,
            name: f.name,
            url: f.url,
            workOrderId: f.workOrderId,
            outcome: f.outcome,
            note: f.note,
            processedAt: f.processedAt.toISOString(),
          })),
        },
      };
    };

    const signerMeta = (headers: Headers | undefined) => ({
      ip:
        headers?.get("cf-connecting-ip") ??
        headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headers?.get("x-real-ip") ??
        null,
      userAgent: headers?.get("user-agent") ?? null,
    });

    const auth = createAuthMiddleware(builder);
    const {
      member,
      manager,
      agencyMember,
      agencyManager,
      treasuryMember,
      treasuryManager,
      defaultOrganizationMember,
      defaultOrganizationManager,
    } = access.middleware(builder);
    const agencyReportViewer = (context: {
      scope: OrganizationScope;
      userId?: string | null;
    }): ReportViewer => ({
      organizationId: context.scope.organizationId,
      userId: context.userId ?? context.scope.actorId,
      canManage: hasRole(ROLE_MATRIX.manage, context.scope.role),
      side: "agency",
    });

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

          getPublic: builder.agency.projects.getPublic.handler(async ({ context, input }) =>
            runEffect(agency.getPublicProject(await access.publicScope(context), input.slug)),
          ),

          getPublicTeam: builder.agency.projects.getPublicTeam
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.getPublicTeam(context.scope, input.projectId)),
            ),

          setPublicTeam: builder.agency.projects.setPublicTeam
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.setPublicTeam(context.scope, input.projectId, input.showTeam)),
            ),

          listOwned: builder.agency.projects.listOwned
            .use(agencyMember)
            .handler(async ({ context }) => runEffect(agency.listProjects(context.scope))),

          get: builder.agency.projects.get
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.getProject(context.scope, input.slug)),
            ),

          getBudget: builder.agency.projects.getBudget
            .use(treasuryMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.getBudget(context.scope, input.projectId)),
            ),

          create: builder.agency.projects.create
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.createProject(context.scope, input)),
            ),

          update: builder.agency.projects.update
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(agency.updateProject(context.scope, input)),
            ),

          delete: builder.agency.projects.delete
            .use(agencyManager)
            .handler(async ({ context, input }) =>
              runEffect(agency.deleteProject(context.scope, input)),
            ),
        },

        listings: {
          get: builder.agency.listings.get
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(listings.getInternal(context.scope, input.projectId)),
            ),

          create: builder.agency.listings.create
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(listings.createInternal(context.scope, input)),
            ),

          update: builder.agency.listings.update
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(listings.updateInternal(context.scope, input)),
            ),

          delete: builder.agency.listings.delete
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(listings.deleteInternal(context.scope, input.projectId)),
            ),
        },

        reports: {
          preview: builder.agency.reports.preview
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              runEffect(reports.generate(context.scope, input)),
            ),

          generate: builder.agency.reports.generate
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { share, ...reportInput } = input;
              const viewer = agencyReportViewer(context);
              if (share) await reports.assertShareable(viewer, reportInput.engagementId ?? null);
              const saved = await runEffect(
                reports.generateSaved(context.scope, reportInput, {
                  organizationId: viewer.organizationId,
                  userId: viewer.userId,
                }),
              );
              if (share) await reports.setShared(viewer, saved.id, true);
              return saved;
            }),

          list: builder.agency.reports.list
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              reports.listSaved(context.scope.organizationId, input, agencyReportViewer(context)),
            ),

          get: builder.agency.reports.get
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              reports.getSaved(
                context.scope.organizationId,
                input.id,
                {},
                agencyReportViewer(context),
              ),
            ),

          share: builder.agency.reports.share
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              reports.setShared(agencyReportViewer(context), input.id, true),
            ),

          unshare: builder.agency.reports.unshare
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              reports.setShared(agencyReportViewer(context), input.id, false),
            ),

          delete: builder.agency.reports.delete
            .use(agencyMember)
            .handler(async ({ context, input }) =>
              reports.deleteSaved(agencyReportViewer(context), input.id),
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
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            engagements.createWithClient(context.scope, input),
          ),

        subcontract: builder.engagements.subcontract
          .use(agencyManager)
          .handler(async ({ context, input }) => engagements.subcontract(context.scope, input)),

        sharedWithUs: builder.engagements.sharedWithUs
          .use(member)
          .handler(async ({ context }) => engagements.sharedWithUs(context.scope)),

        propose: builder.engagements.propose
          .use(agencyManager)
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
          .use(agencyManager)
          .handler(async ({ context, input }) => engagements.share(context.scope, input)),

        unshare: builder.engagements.unshare
          .use(agencyManager)
          .handler(async ({ context, input }) => engagements.unshare(context.scope, input)),

        invitation: {
          resend: builder.engagements.invitation.resend
            .use(agencyManager)
            .handler(async ({ context, input }) =>
              engagements.resendInvitation(context.scope, input.id),
            ),

          cancel: builder.engagements.invitation.cancel
            .use(agencyManager)
            .handler(async ({ context, input }) =>
              engagements.cancelInvitation(context.scope, input.id),
            ),

          changeEmail: builder.engagements.invitation.changeEmail
            .use(agencyManager)
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
          listAll: builder.clientPortal.projects.listAll
            .use(auth.requireAuth)
            .handler(async ({ context }) => runEffect(clientPortal.listAllProjects(context))),

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

        agreements: {
          list: builder.clientPortal.agreements.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => clientPortal.listAgreements(context, input)),
        },

        reports: {
          preview: builder.clientPortal.reports.preview
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.previewReport(context, input)),
            ),

          delete: builder.clientPortal.reports.delete
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => clientPortal.deleteReport(context, input)),

          generate: builder.clientPortal.reports.generate
            .use(auth.requireAuth)
            .handler(async ({ context, input }) =>
              runEffect(clientPortal.generateReport(context, input)),
            ),

          list: builder.clientPortal.reports.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => clientPortal.listReports(context, input)),

          get: builder.clientPortal.reports.get
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => clientPortal.getReport(context, input)),
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
        list: builder.contributors.list.use(agencyMember).handler(async ({ context }) => {
          const isManager =
            context.scope.role !== null &&
            (ROLE_MATRIX.manage as readonly string[]).includes(context.scope.role);
          return runEffect(
            contributors.list(
              context.scope.pluginContext,
              isManager ? { organizationId: context.scope.organizationId } : undefined,
            ),
          );
        }),

        get: builder.contributors.get.use(agencyMember).handler(async ({ context, input }) => {
          const isManager =
            context.scope.role !== null &&
            (ROLE_MATRIX.manage as readonly string[]).includes(context.scope.role);
          return runEffect(
            contributors.get(
              context.scope.pluginContext,
              input.nearAccount,
              isManager ? { organizationId: context.scope.organizationId } : undefined,
            ),
          );
        }),

        create: builder.contributors.create
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            return runEffect(
              contributors.create(context.scope.pluginContext, input, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),

        update: builder.contributors.update
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            return runEffect(
              contributors.update(context.scope.pluginContext, input, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),

        delete: builder.contributors.delete
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            return runEffect(
              contributors.delete(context.scope.pluginContext, input.nearAccount, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),
      },

      members: {
        list: builder.members.list
          .use(auth.requireAuth)
          .handler(async ({ context }) => runEffect(contributors.members(context))),

        recordAgreement: builder.members.recordAgreement
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            await runEffect(contributors.recordAgreement(context, input));
            return { recorded: true };
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

      workOrders: {
        list: builder.workOrders.list
          .use(agencyMember)
          .handler(async ({ context, input }) => workOrders.list(context.scope, input)),

        get: builder.workOrders.get
          .use(agencyMember)
          .handler(async ({ context, input }) => workOrders.get(context.scope, input)),

        create: builder.workOrders.create
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.create(context.scope, input)),

        update: builder.workOrders.update
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.update(context.scope, input)),

        delete: builder.workOrders.delete
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.remove(context.scope, input)),

        offer: builder.workOrders.offer
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.offer(context.scope, input)),

        document: builder.workOrders.document
          .use(agencyMember)
          .handler(async ({ context, input }) => workOrders.document(context.scope, input)),

        countersign: builder.workOrders.countersign
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            workOrders.countersign(context.scope, input, signerMeta(context.reqHeaders)),
          ),

        activate: builder.workOrders.activate
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.activate(context.scope, input)),

        terminate: builder.workOrders.terminate
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.terminate(context.scope, input)),

        attachDocument: builder.workOrders.attachDocument
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.attachDocument(context.scope, input)),

        collect: builder.workOrders.collect
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.collect(context.scope, input)),

        draftRequest: builder.workOrders.draftRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.draftRequest(context.scope, input)),

        approveRequest: builder.workOrders.approveRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.approveRequest(context.scope, input)),

        rejectRequest: builder.workOrders.rejectRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.rejectRequest(context.scope, input)),

        linkProposal: builder.workOrders.linkProposal
          .use(treasuryManager)
          .handler(async ({ context, input }) => workOrders.linkProposal(context.scope, input)),

        paymentProposal: builder.workOrders.paymentProposal
          .use(treasuryManager)
          .handler(async ({ context, input }) => workOrders.paymentProposal(context.scope, input)),

        payNow: builder.workOrders.payNow
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.payNow(context.scope, input)),

        stopAutoApproval: builder.workOrders.stopAutoApproval
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.stopAutoApproval(context.scope, input)),

        trustSettings: builder.workOrders.trustSettings
          .use(agencyManager)
          .handler(async ({ context }) => workOrders.trustSettings(context.scope)),

        saveTrustSettings: builder.workOrders.saveTrustSettings
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            await workOrderIntegrations.saveTrust(
              context.scope.organizationId,
              context.scope.actorId,
              input,
            );
            return workOrders.trustSettings(context.scope);
          }),

        payoutAgent: builder.workOrders.payoutAgent
          .use(agencyManager)
          .handler(async ({ context }) => payoutAgents.view(context.scope.organizationId)),

        savePayoutAgent: builder.workOrders.savePayoutAgent
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            payoutAgents.saveSettings(context.scope.organizationId, context.scope.actorId, input),
          ),

        preparePayoutAction: builder.workOrders.preparePayoutAction
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            payoutAgents.prepare(context.scope.organizationId, input),
          ),

        submitPayoutAction: builder.workOrders.submitPayoutAction
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            payoutAgents.submit(context.scope.organizationId, input),
          ),

        allowPayees: builder.workOrders.allowPayees
          .use(agencyManager)
          .handler(async ({ context }) => {
            const result = await payoutAgents.ensurePayees(context.scope.organizationId);
            return { ...result, view: await payoutAgents.view(context.scope.organizationId) };
          }),

        payoutFunding: builder.workOrders.payoutFunding
          .use(treasuryManager)
          .handler(async ({ context }) => {
            const [needs, agent] = await Promise.all([
              workOrders.fundingNeeds(context.scope),
              payoutAgents.view(context.scope.organizationId),
            ]);
            const bufferPercent = needs.priceUsd ? 2 : 0;
            const needed = needs.near + (needs.near * BigInt(bufferPercent)) / 100n;
            const balance = agent.balance ? BigInt(nearToAtomic(agent.balance.near)) : null;
            const check = await payoutAgents.fundingCheck(context.scope.organizationId, {
              near: needed,
              priceUsd: needs.priceUsd,
            });
            return {
              items: needs.items.map((item) => ({
                ...item,
                near: atomicToNear(BigInt(item.near)),
              })),
              priceUsd: needs.priceUsd,
              bufferPercent,
              neededNear: atomicToNear(needed),
              balanceNear: agent.balance?.near ?? null,
              topUpNear: atomicToNear(topUpFor(needed, balance ?? 0n)),
              lowBalance: check?.lowBalance ?? false,
              monthlyBudgetUsd: check?.monthlyBudgetUsd ?? null,
              monthlyNeededUsd: check?.monthlyNeededUsd ?? null,
              suggestedBudgetUsd: check?.suggestedBudgetUsd ?? null,
              budgetTooLow: check?.budgetTooLow ?? false,
            };
          }),

        payoutTopUp: builder.workOrders.payoutTopUp
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const deposit = await payoutAgents.depositAddress(context.scope.organizationId);
            return {
              address: deposit.address,
              memo: deposit.memo,
              minAmount: deposit.minAmount,
              daoAccountId: context.scope.agencyDao,
              method: "add_proposal" as const,
              args: {
                proposal: {
                  description: `Top up the MultiAgency payout agent with ${input.amountNear} NEAR`,
                  kind: {
                    Transfer: {
                      token_id: "",
                      receiver_id: deposit.address,
                      amount: nearToAtomic(input.amountNear),
                      msg: null,
                    },
                  },
                },
              },
              deposit: await getProposalBond(context.scope.agencyDao),
              gas: "100000000000000",
            };
          }),

        refreshPayment: builder.workOrders.refreshPayment
          .use(agencyMember)
          .handler(async ({ context, input }) => workOrders.refreshPayment(context.scope, input)),

        decideRenewal: builder.workOrders.decideRenewal
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.decideRenewal(context.scope, input)),

        setGithubLogin: builder.workOrders.setGithubLogin
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.setGithubLogin(context.scope, input)),

        prepareDocument: builder.workOrders.prepareDocument
          .use(agencyManager)
          .handler(async ({ context, input }) => workOrders.prepareDocument(context.scope, input)),

        requestPayeeConfirmation: builder.workOrders.requestPayeeConfirmation
          .use(agencyManager)
          .handler(async ({ context, input }) =>
            workOrders.requestPayeeConfirmation(context.scope, input),
          ),

        integration: builder.workOrders.integration
          .use(agencyManager)
          .handler(async ({ context }) => integrationView(context.scope.organizationId)),

        saveGoogle: builder.workOrders.saveGoogle
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const templateId = await checkGoogleFile("Template", input.templateUrl, "document");
            const documentsFolderId = await checkGoogleFile(
              "Documents folder",
              input.documentsFolderUrl,
              "folder",
              true,
            );
            const signedFolderId = await checkGoogleFile(
              "Signed folder",
              input.signedFolderUrl,
              "folder",
            );
            await workOrderIntegrations.saveGoogle(
              context.scope.organizationId,
              context.scope.actorId,
              {
                templateId,
                documentsFolderId,
                signedFolderId,
              },
            );
            return integrationView(context.scope.organizationId);
          }),

        checkDrive: builder.workOrders.checkDrive
          .use(agencyManager)
          .handler(async ({ context }) => {
            const result = await workOrders.checkDrive(context.scope);
            return { ...(await integrationView(context.scope.organizationId)), result };
          }),

        run: builder.workOrders.run.handler(async ({ context }) => {
          const given = context.reqHeaders?.get("authorization") ?? "";
          if (!workOrdersRunSecret || !sameSecret(given, `Bearer ${workOrdersRunSecret}`)) {
            throw new ORPCError("UNAUTHORIZED", { message: "A valid run secret is required" });
          }
          return workOrders.run();
        }),
      },

      myWorkOrders: {
        list: builder.myWorkOrders.list
          .use(auth.requireAuth)
          .handler(async ({ context }) => workOrders.mine(context)),

        get: builder.myWorkOrders.get
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.mineGet(context, input)),

        document: builder.myWorkOrders.document
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.myDocument(context, input)),

        sign: builder.myWorkOrders.sign
          .use(auth.requireAuth)
          .handler(async ({ context, input }) =>
            workOrders.sign(context, input, signerMeta(context.reqHeaders)),
          ),

        confirmPayee: builder.myWorkOrders.confirmPayee
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.confirmPayee(context, input)),

        decline: builder.myWorkOrders.decline
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.decline(context, input)),

        draftRequest: builder.myWorkOrders.draftRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.mineDraftRequest(context, input)),

        editRequest: builder.myWorkOrders.editRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.editRequest(context, input)),

        submitRequest: builder.myWorkOrders.submitRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => workOrders.submitRequest(context, input)),
      },

      agreements: {
        list: builder.agreements.list
          .use(agencyMember)
          .handler(async ({ context, input }) => agreements.list(context.scope, input)),

        create: builder.agreements.create
          .use(agencyManager)
          .handler(async ({ context, input }) => agreements.create(context.scope, input)),

        update: builder.agreements.update
          .use(agencyManager)
          .handler(async ({ context, input }) => agreements.update(context.scope, input)),

        delete: builder.agreements.delete
          .use(agencyManager)
          .handler(async ({ context, input }) => agreements.remove(context.scope, input)),
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

        update: builder.budgets.update
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(budgets.update(context.scope, input))),

        delete: builder.budgets.delete
          .use(treasuryManager)
          .handler(async ({ context, input }) => runEffect(budgets.remove(context.scope, input))),

        deleted: builder.budgets.deleted
          .use(treasuryMember)
          .handler(async ({ context, input }) =>
            runEffect(budgets.listDeleted(context.scope, input)),
          ),
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

      community: {
        searchBuilders: builder.community.searchBuilders
          .use(agencyMember)
          .handler(async ({ input }) => community.searchBuilders(input)),

        searchProjects: builder.community.searchProjects
          .use(agencyMember)
          .handler(async ({ input }) => community.searchProjects(input)),
      },

      nearn: {
        getListing: builder.nearn.getListing
          .use(agencyMember)
          .handler(async ({ context, input }) => runEffect(nearn.getListing(context.scope, input))),

        listSponsorBounties: builder.nearn.listSponsorBounties
          .use(agencyMember)
          .handler(async ({ context }) => runEffect(nearn.listSponsorBounties(context.scope))),

        listSubmissions: builder.nearn.listSubmissions
          .use(agencyMember)
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
          const resolved = await access.resolve(context);
          const { role, agencyDao, capabilities } = resolved;
          return {
            orgRole: role === "admin" || role === "member" || role === "owner" ? role : null,
            agencyDao,
            capabilities,
            recommendedView: await access.recommendedView(resolved),
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
          .use(agencyManager)
          .handler(async ({ context }) =>
            getAdminSettings(db, context.scope, getNetwork(context.reqHeaders)),
          ),

        update: builder.agencyConfig.update
          .use(agencyManager)
          .handler(async ({ context, input }) => {
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

function sameSecret(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
