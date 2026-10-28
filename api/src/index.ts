import { timingSafeEqual } from "node:crypto";
import { AgentApi } from "@near-intents-agent-api/sdk";
import { ORPCError } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { buildScoped, createPlugin, type PluginInitializeInput } from "every-plugin";
import pg from "pg";
import { z } from "zod";
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
  actorOf,
  agencyDaoOf,
  createOrganizationAccess,
  hasRole,
  type OrganizationScope,
  ROLE_MATRIX,
} from "./services/organization-access";
import { atomicToNear, nearToAtomic, topUpFor, topUpProposal } from "./services/payouts/policy";
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
import { findProposal, fullAccessKeys, getProposalBond, getRoles } from "./services/sputnik";
import { createTokensService } from "./services/tokens";
import { createTreasuryService } from "./services/treasury";
import { createConsistencyChecker } from "./services/work-orders/consistency";
import { createDocumenso } from "./services/work-orders/documenso";
import { cachedOwnership, createGitHub } from "./services/work-orders/github";
import {
  createGoogle,
  GoogleError,
  type GooglePort,
  googleIdOf,
  parseServiceAccount,
  readServiceAccount,
} from "./services/work-orders/google";
import { createGoogleConnections, GoogleConnectError } from "./services/work-orders/google-oauth";
import { createGoogleSetup, GoogleSetupError } from "./services/work-orders/google-setup";
import { createWorkOrderIntegrations, createWorkOrderOutbox } from "./services/work-orders/outbox";
import { createPriceFeed } from "./services/work-orders/prices";
import { scheduleWorkOrders, stopWorkOrders } from "./services/work-orders/scheduler";
import { createWorkOrdersService } from "./services/work-orders/service";
import { createSetupStatus } from "./services/work-orders/setup-status";
import { createSummarizer } from "./services/work-orders/summarizer";
import {
  askFields,
  createFieldsFinder,
  KNOWN_FIELDS,
  parseFieldMap,
} from "./services/work-orders/template-fields";
import { isTimeZone, UTC } from "./services/work-orders/time";
import { DEFAULT_RENEWAL } from "./services/work-orders/types";

const variables = z.object({
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
      minIssuesDonePct: z.number().int().min(0).max(100).default(DEFAULT_RENEWAL.minIssuesDonePct),
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
});

const secrets = z.object({
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
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PICKER_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_PROJECT_NUMBER: z.string().optional(),
  GOOGLE_STARTER_TEMPLATE_ID: z.string().optional(),
  GOOGLE_TOKENS_SECRET_KEY: z.string().optional(),
  NEAR_INTENTS_AGENT_API_KEY: z.string().optional(),
  NEAR_INTENTS_AGENT_API_URL: z.string().optional(),
  DOCUMENSO_API_KEY: z.string().optional(),
  DOCUMENSO_API_URL: z.string().optional(),
  PAYOUTS_SECRET_KEY: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().default(""),
});

const initializeServices = (
  config: PluginInitializeInput<typeof variables, typeof secrets>,
  plugins: PluginsClient,
) =>
  Effect.gen(function* () {
    const db = yield* buildScoped(DatabaseTag, DatabaseLive(config.secrets.API_DATABASE_URL));

    const notifyConfig = {
      webhookUrl: config.secrets.APPLICATIONS_WEBHOOK_URL,
      resendApiKey: config.secrets.RESEND_API_KEY,
      fromEmail: config.secrets.NOTIFY_FROM_EMAIL,
    };

    const directory = createProjectDirectory((pluginContext) =>
      plugins.projects.client(pluginContext),
    );
    const authDatabaseUrl = config.secrets.AUTH_DATABASE_URL;
    const authPool = authDatabaseUrl ? new pg.Pool({ connectionString: authDatabaseUrl }) : null;
    const organizationDirectory = authPool
      ? authDatabaseDirectory(authPool)
      : unconfiguredDirectory();
    const appOrigin = (config.secrets.APP_ORIGIN ?? config.variables.appOrigin).replace(/\/+$/, "");
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
      organizations: betterAuthOrganizations(() => plugins.auth.client()),
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
    const googleClientId = config.secrets.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const googleClientSecret = config.secrets.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const googleConnections = createGoogleConnections({
      db,
      config:
        googleClientId && googleClientSecret
          ? {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              redirectUri: `${appOrigin}/api/work-orders/google/callback`,
              secretKey:
                config.secrets.GOOGLE_TOKENS_SECRET_KEY ??
                config.secrets.PAYOUTS_SECRET_KEY ??
                null,
              pickerApiKey: config.secrets.GOOGLE_PICKER_API_KEY?.trim() || null,
              projectNumber: config.secrets.GOOGLE_CLOUD_PROJECT_NUMBER?.trim() || null,
            }
          : null,
    });
    const googleFor = async (organizationId: string): Promise<GooglePort | null> =>
      (await googleConnections.port(organizationId)) ?? google;
    const googleSetup = createGoogleSetup({
      db,
      googleFor,
      finder: createFieldsFinder({ apiKey: config.secrets.ANTHROPIC_API_KEY }),
      starterTemplateId: googleIdOf(config.secrets.GOOGLE_STARTER_TEMPLATE_ID),
    });
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
    const signedInNearKeys = async (userId: string | null | undefined) => {
      if (!authPool || !userId) return {};
      const { rows } = await authPool.query<{ account_id: string; public_key: string }>(
        "SELECT account_id, public_key FROM near_account WHERE user_id = $1",
        [userId],
      );
      return Object.fromEntries(rows.map((r) => [r.account_id, r.public_key]));
    };
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
            const { data } = await plugins.builders.client({}).getBuilder({ nearAccount });
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
      proposal: (daoAccountId, proposalId) => findProposal(db, daoAccountId, proposalId),
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
      googleFor: googleConnections.port,
      userEmail,
      appOrigin,
      timeZone: config.variables.workOrderTimezone,
    });
    const workOrderSetup = createSetupStatus({
      organizationName: async (organizationId) =>
        (await organizationDirectory.get(organizationId))?.name ?? null,
      representative: workOrderIntegrations.representative,
      emailEnabled: sendEmail !== null,
      esignEnabled: !!config.secrets.DOCUMENSO_API_KEY,
      google: {
        serviceAccount: google !== null,
        connection: googleConnections.status,
        settings: workOrderIntegrations.settings,
      },
      payouts: payoutAgents,
      fundingNeeds: workOrders.fundingNeeds,
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
      workOrderSetup,
      appOrigin,
      google,
      googleConnections,
      googleFor,
      googleSetup,
      payoutAgents,
      signedInNearKeys,
      workOrderTimers,
    };
  });

type ApiServicesShape = Effect.Success<ReturnType<typeof initializeServices>>;

class ApiServices extends Context.Service<ApiServices, ApiServicesShape>()("ApiServices") {}

export default createPlugin.withPlugins<PluginsClient>()({
  variables,

  secrets,

  context: ContextSchema,

  contract,

  initialize: (config, plugins) =>
    Effect.gen(function* () {
      const services = yield* initializeServices(config, plugins);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          stopWorkOrders(services.workOrderTimers);
          if (services.authPool) yield* Effect.promise(() => services.authPool!.end());
          yield* Effect.logInfo("[API] Shutdown");
        }),
      );
      return Layer.succeed(ApiServices, services);
    }),

  createRouter: (builder, plugins) => {
    const googleUrl = {
      document: (id: string | null) =>
        id ? `https://docs.google.com/document/d/${id}/edit` : null,
      folder: (id: string | null) => (id ? `https://drive.google.com/drive/folders/${id}` : null),
    };

    const checkGoogleFile = async (
      services: ApiServicesShape,
      organizationId: string,
      label: string,
      value: string | null,
      kind: "document" | "folder",
      sharedDriveOnly = false,
    ): Promise<string | null> => {
      const { googleFor } = services;
      if (!value) return null;
      const id = googleIdOf(value);
      if (!id) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${label}: paste the Google ${kind === "document" ? "Docs" : "Drive folder"} link`,
          data: { reason: "INVALID_GOOGLE_LINK" },
        });
      }
      const port = await googleFor(organizationId);
      if (!port) return id;
      const mime =
        kind === "document"
          ? "application/vnd.google-apps.document"
          : "application/vnd.google-apps.folder";
      try {
        const file = await port.file(id);
        if (file.mimeType !== mime) {
          throw new Error(`it's not a Google ${kind === "document" ? "Doc" : "Drive folder"}`);
        }
        if (sharedDriveOnly && port.kind === "service_account" && !file.driveId) {
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

    const integrationView = async (services: ApiServicesShape, organizationId: string) => {
      const {
        workOrderIntegrations,
        googleConnections,
        workOrderEmails,
        workOrderAiDrafts,
        google,
        googleSetup,
      } = services;
      const [settings, deliveries, oauth] = await Promise.all([
        workOrderIntegrations.settings(organizationId),
        workOrderIntegrations.recent(organizationId),
        googleConnections.status(organizationId),
      ]);
      const fieldMap = parseFieldMap(settings?.googleFieldMap);
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
          available: google !== null || googleConnections.available,
          serviceAccountEmail: google?.email ?? null,
          oauth: {
            available: googleConnections.available,
            canConnect: googleConnections.canConnect,
            connected: oauth.connected,
            email: oauth.email,
            error: oauth.error,
            redirectUri: googleConnections.redirectUri,
            picker: googleConnections.picker !== null,
          },
          starterAvailable: googleSetup.starterAvailable,
          aiFieldsAvailable: workOrderAiDrafts,
          knownFields: Object.entries(KNOWN_FIELDS).map(([key, label]) => ({ key, label })),
          fieldMap,
          askFields: askFields(fieldMap),
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
    const asAdmin = (reqHeaders: Headers | undefined) =>
      plugins.auth.client({ reqHeaders: Object.fromEntries(new Headers(reqHeaders).entries()) });
    type AccessMiddlewares = ReturnType<ApiServicesShape["access"]["middleware"]>;
    const deferredAccess = <K extends keyof AccessMiddlewares>(key: K) =>
      ((
        options: { context: { "effect/context": Context.Context<ApiServices> } },
        ...rest: unknown[]
      ) =>
        (
          Context.get(options.context["effect/context"], ApiServices).access.middleware(builder)[
            key
          ] as (...args: unknown[]) => unknown
        )(options, ...rest)) as unknown as AccessMiddlewares[K];
    const {
      member,
      manager,
      agencyMember,
      agencyManager,
      treasuryMember,
      treasuryManager,
      defaultOrganizationMember,
      defaultOrganizationManager,
    } = {
      member: deferredAccess("member"),
      manager: deferredAccess("manager"),
      agencyMember: deferredAccess("agencyMember"),
      agencyManager: deferredAccess("agencyManager"),
      treasuryMember: deferredAccess("treasuryMember"),
      treasuryManager: deferredAccess("treasuryManager"),
      defaultOrganizationMember: deferredAccess("defaultOrganizationMember"),
      defaultOrganizationManager: deferredAccess("defaultOrganizationManager"),
    };
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
        submit: builder.contact.submit.handler(async ({ input, context }) => {
          const { contactForm } = Context.get(context["effect/context"], ApiServices);
          return runEffect(contactForm.submit(input));
        }),
      },

      applications: {
        create: builder.applications.create.handler(async ({ input, context }) => {
          const { applications } = Context.get(context["effect/context"], ApiServices);
          return runEffect(applications.create(input));
        }),

        list: builder.applications.list
          .use(defaultOrganizationMember)
          .handler(async ({ input, context }) => {
            const { applications } = Context.get(context["effect/context"], ApiServices);
            return runEffect(applications.list(input));
          }),

        update: builder.applications.update
          .use(defaultOrganizationManager)
          .handler(async ({ context, input }) => {
            const { applications } = Context.get(context["effect/context"], ApiServices);
            return runEffect(
              applications.update({ near: { primaryAccountId: context.scope.actorId } }, input),
            );
          }),

        convertToBuilder: builder.applications.convertToBuilder
          .use(defaultOrganizationManager)
          .handler(async ({ context, input }) => {
            const { applications } = Context.get(context["effect/context"], ApiServices);
            return runEffect(applications.convertToBuilder(context.scope, input));
          }),
      },

      agency: {
        projects: {
          list: builder.agency.projects.list.handler(async ({ context }) => {
            const { agency, access } = Context.get(context["effect/context"], ApiServices);
            return runEffect(agency.listProjects(await access.publicScope(context)));
          }),

          getPublic: builder.agency.projects.getPublic.handler(async ({ context, input }) => {
            const { agency, access } = Context.get(context["effect/context"], ApiServices);
            return runEffect(
              agency.getPublicProject(await access.publicScope(context), input.slug),
            );
          }),

          getPublicTeam: builder.agency.projects.getPublicTeam
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.getPublicTeam(context.scope, input.projectId));
            }),

          setPublicTeam: builder.agency.projects.setPublicTeam
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(
                agency.setPublicTeam(context.scope, input.projectId, input.showTeam),
              );
            }),

          listOwned: builder.agency.projects.listOwned
            .use(agencyMember)
            .handler(async ({ context }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.listProjects(context.scope));
            }),

          get: builder.agency.projects.get.use(agencyMember).handler(async ({ context, input }) => {
            const { agency } = Context.get(context["effect/context"], ApiServices);
            return runEffect(agency.getProject(context.scope, input.slug));
          }),

          getBudget: builder.agency.projects.getBudget
            .use(treasuryMember)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.getBudget(context.scope, input.projectId));
            }),

          create: builder.agency.projects.create
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.createProject(context.scope, input));
            }),

          update: builder.agency.projects.update
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.updateProject(context.scope, input));
            }),

          delete: builder.agency.projects.delete
            .use(agencyManager)
            .handler(async ({ context, input }) => {
              const { agency } = Context.get(context["effect/context"], ApiServices);
              return runEffect(agency.deleteProject(context.scope, input));
            }),
        },

        listings: {
          get: builder.agency.listings.get.use(agencyMember).handler(async ({ context, input }) => {
            const { listings } = Context.get(context["effect/context"], ApiServices);
            return runEffect(listings.getInternal(context.scope, input.projectId));
          }),

          create: builder.agency.listings.create
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { listings } = Context.get(context["effect/context"], ApiServices);
              return runEffect(listings.createInternal(context.scope, input));
            }),

          update: builder.agency.listings.update
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { listings } = Context.get(context["effect/context"], ApiServices);
              return runEffect(listings.updateInternal(context.scope, input));
            }),

          delete: builder.agency.listings.delete
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { listings } = Context.get(context["effect/context"], ApiServices);
              return runEffect(listings.deleteInternal(context.scope, input.projectId));
            }),
        },

        reports: {
          preview: builder.agency.reports.preview
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
              return runEffect(reports.generate(context.scope, input));
            }),

          generate: builder.agency.reports.generate
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
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
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
              return reports.listSaved(
                context.scope.organizationId,
                input,
                agencyReportViewer(context),
              );
            }),

          get: builder.agency.reports.get.use(agencyMember).handler(async ({ context, input }) => {
            const { reports } = Context.get(context["effect/context"], ApiServices);
            return reports.getSaved(
              context.scope.organizationId,
              input.id,
              {},
              agencyReportViewer(context),
            );
          }),

          share: builder.agency.reports.share
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
              return reports.setShared(agencyReportViewer(context), input.id, true);
            }),

          unshare: builder.agency.reports.unshare
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
              return reports.setShared(agencyReportViewer(context), input.id, false);
            }),

          delete: builder.agency.reports.delete
            .use(agencyMember)
            .handler(async ({ context, input }) => {
              const { reports } = Context.get(context["effect/context"], ApiServices);
              return reports.deleteSaved(agencyReportViewer(context), input.id);
            }),
        },
      },

      engagements: {
        list: builder.engagements.list.use(member).handler(async ({ context }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.list(context.scope);
        }),

        get: builder.engagements.get.use(member).handler(async ({ context, input }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.get(context.scope, input.id);
        }),

        createWithClient: builder.engagements.createWithClient
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { engagements } = Context.get(context["effect/context"], ApiServices);
            return engagements.createWithClient(context.scope, input);
          }),

        subcontract: builder.engagements.subcontract
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { engagements } = Context.get(context["effect/context"], ApiServices);
            return engagements.subcontract(context.scope, input);
          }),

        sharedWithUs: builder.engagements.sharedWithUs.use(member).handler(async ({ context }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.sharedWithUs(context.scope);
        }),

        propose: builder.engagements.propose
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { engagements } = Context.get(context["effect/context"], ApiServices);
            return engagements.propose(context.scope, input);
          }),

        accept: builder.engagements.accept.use(manager).handler(async ({ context, input }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.accept(context.scope, input.id);
        }),

        decline: builder.engagements.decline.use(manager).handler(async ({ context, input }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.decline(context.scope, input.id);
        }),

        end: builder.engagements.end.use(manager).handler(async ({ context, input }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.end(context.scope, input.id);
        }),

        share: builder.engagements.share.use(agencyManager).handler(async ({ context, input }) => {
          const { engagements } = Context.get(context["effect/context"], ApiServices);
          return engagements.share(context.scope, input);
        }),

        unshare: builder.engagements.unshare
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { engagements } = Context.get(context["effect/context"], ApiServices);
            return engagements.unshare(context.scope, input);
          }),

        invitation: {
          resend: builder.engagements.invitation.resend
            .use(agencyManager)
            .handler(async ({ context, input }) => {
              const { engagements } = Context.get(context["effect/context"], ApiServices);
              return engagements.resendInvitation(context.scope, input.id);
            }),

          cancel: builder.engagements.invitation.cancel
            .use(agencyManager)
            .handler(async ({ context, input }) => {
              const { engagements } = Context.get(context["effect/context"], ApiServices);
              return engagements.cancelInvitation(context.scope, input.id);
            }),

          changeEmail: builder.engagements.invitation.changeEmail
            .use(agencyManager)
            .handler(async ({ context, input }) => {
              const { engagements } = Context.get(context["effect/context"], ApiServices);
              return engagements.changeInvitationEmail(context.scope, input.id, input.email);
            }),
        },
      },

      prepayments: {
        list: builder.prepayments.list.use(member).handler(async ({ context, input }) => {
          const { prepayments } = Context.get(context["effect/context"], ApiServices);
          return prepayments.list(context.scope, input);
        }),

        balance: builder.prepayments.balance.use(member).handler(async ({ context, input }) => {
          const { prepayments } = Context.get(context["effect/context"], ApiServices);
          return prepayments.balance(context.scope, input);
        }),

        record: builder.prepayments.record.use(manager).handler(async ({ context, input }) => {
          const { prepayments } = Context.get(context["effect/context"], ApiServices);
          return prepayments.record(context.scope, input);
        }),

        correct: builder.prepayments.correct.use(manager).handler(async ({ context, input }) => {
          const { prepayments } = Context.get(context["effect/context"], ApiServices);
          return prepayments.correct(context.scope, input);
        }),

        remove: builder.prepayments.remove.use(manager).handler(async ({ context, input }) => {
          const { prepayments } = Context.get(context["effect/context"], ApiServices);
          return prepayments.remove(context.scope, input);
        }),
      },

      changeOrders: {
        list: builder.changeOrders.list.use(member).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.list(context.scope, input);
        }),

        awaiting: builder.changeOrders.awaiting.use(member).handler(async ({ context }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.awaiting(context.scope);
        }),

        plan: builder.changeOrders.plan.use(member).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.plan(context.scope, input);
        }),

        propose: builder.changeOrders.propose.use(manager).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.propose(context.scope, input);
        }),

        withdraw: builder.changeOrders.withdraw.use(manager).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.withdraw(context.scope, input);
        }),

        approve: builder.changeOrders.approve.use(manager).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.approve(context.scope, input);
        }),

        reject: builder.changeOrders.reject.use(manager).handler(async ({ context, input }) => {
          const { changeOrders } = Context.get(context["effect/context"], ApiServices);
          return changeOrders.reject(context.scope, input);
        }),
      },

      ideas: {
        list: builder.ideas.list.use(member).handler(async ({ context, input }) => {
          const { ideas } = Context.get(context["effect/context"], ApiServices);
          return ideas.list(context.scope, input);
        }),

        submit: builder.ideas.submit.use(member).handler(async ({ context, input }) => {
          const { ideas } = Context.get(context["effect/context"], ApiServices);
          return ideas.submit(context.scope, input);
        }),

        accept: builder.ideas.accept.use(manager).handler(async ({ context, input }) => {
          const { ideas } = Context.get(context["effect/context"], ApiServices);
          return ideas.accept(context.scope, input);
        }),

        decline: builder.ideas.decline.use(manager).handler(async ({ context, input }) => {
          const { ideas } = Context.get(context["effect/context"], ApiServices);
          return ideas.decline(context.scope, input);
        }),
      },

      agentLinks: {
        list: builder.agentLinks.list.use(member).handler(async ({ context, input }) => {
          const { agentLinks } = Context.get(context["effect/context"], ApiServices);
          return agentLinks.list(context.scope, input);
        }),

        create: builder.agentLinks.create.use(manager).handler(async ({ context, input }) => {
          const { agentLinks } = Context.get(context["effect/context"], ApiServices);
          return agentLinks.create(context.scope, input);
        }),

        update: builder.agentLinks.update.use(manager).handler(async ({ context, input }) => {
          const { agentLinks } = Context.get(context["effect/context"], ApiServices);
          return agentLinks.update(context.scope, input);
        }),

        reorder: builder.agentLinks.reorder.use(manager).handler(async ({ context, input }) => {
          const { agentLinks } = Context.get(context["effect/context"], ApiServices);
          return agentLinks.reorder(context.scope, input);
        }),

        remove: builder.agentLinks.remove.use(manager).handler(async ({ context, input }) => {
          const { agentLinks } = Context.get(context["effect/context"], ApiServices);
          return agentLinks.remove(context.scope, input);
        }),
      },

      clientPortal: {
        dashboard: {
          summary: builder.clientPortal.dashboard.summary
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.dashboardSummary(context, input));
            }),
        },

        projects: {
          listAll: builder.clientPortal.projects.listAll
            .use(auth.requireAuth)
            .handler(async ({ context }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.listAllProjects(context));
            }),

          list: builder.clientPortal.projects.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.listProjects(context, input));
            }),

          get: builder.clientPortal.projects.get
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.getProject(context, input));
            }),

          getBudget: builder.clientPortal.projects.getBudget
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.getBudget(context, input));
            }),
        },

        billings: {
          list: builder.clientPortal.billings.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.listBillings(context, input));
            }),
        },

        agreements: {
          list: builder.clientPortal.agreements.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return clientPortal.listAgreements(context, input);
            }),
        },

        reports: {
          preview: builder.clientPortal.reports.preview
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.previewReport(context, input));
            }),

          delete: builder.clientPortal.reports.delete
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return clientPortal.deleteReport(context, input);
            }),

          generate: builder.clientPortal.reports.generate
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return runEffect(clientPortal.generateReport(context, input));
            }),

          list: builder.clientPortal.reports.list
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return clientPortal.listReports(context, input);
            }),

          get: builder.clientPortal.reports.get
            .use(auth.requireAuth)
            .handler(async ({ context, input }) => {
              const { clientPortal } = Context.get(context["effect/context"], ApiServices);
              return clientPortal.getReport(context, input);
            }),
        },
      },

      notifications: {
        list: builder.notifications.list
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { notifications } = Context.get(context["effect/context"], ApiServices);
            return notifications.list(context.userId, input);
          }),

        unreadCount: builder.notifications.unreadCount
          .use(auth.requireAuth)
          .handler(async ({ context }) => {
            const { notifications } = Context.get(context["effect/context"], ApiServices);
            return notifications.unreadCount(context.userId);
          }),

        markRead: builder.notifications.markRead
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { notifications } = Context.get(context["effect/context"], ApiServices);
            return notifications.markRead(context.userId, input);
          }),
      },

      contributors: {
        list: builder.contributors.list.use(agencyMember).handler(async ({ context }) => {
          const { contributors } = Context.get(context["effect/context"], ApiServices);
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
          const { contributors } = Context.get(context["effect/context"], ApiServices);
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
            const { contributors } = Context.get(context["effect/context"], ApiServices);
            return runEffect(
              contributors.create(context.scope.pluginContext, input, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),

        update: builder.contributors.update
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { contributors } = Context.get(context["effect/context"], ApiServices);
            return runEffect(
              contributors.update(context.scope.pluginContext, input, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),

        delete: builder.contributors.delete
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { contributors } = Context.get(context["effect/context"], ApiServices);
            return runEffect(
              contributors.delete(context.scope.pluginContext, input.nearAccount, {
                organizationId: context.scope.organizationId,
              }),
            );
          }),
      },

      members: {
        list: builder.members.list.use(auth.requireAuth).handler(async ({ context }) => {
          const { contributors } = Context.get(context["effect/context"], ApiServices);
          return runEffect(contributors.members(context));
        }),

        recordAgreement: builder.members.recordAgreement
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { contributors } = Context.get(context["effect/context"], ApiServices);
            await runEffect(contributors.recordAgreement(context, input));
            return { recorded: true };
          }),
      },

      organizationRequests: {
        list: builder.organizationRequests.list
          .use(auth.requireAdmin)
          .handler(async ({ context }) => {
            const { organizationDirectory } = Context.get(context["effect/context"], ApiServices);
            const requests = await asAdmin(context.reqHeaders).listOrganizationRequests();
            return {
              data: await Promise.all(
                requests.map(async (request) => ({
                  id: request.id,
                  name: request.name,
                  slug: request.slug,
                  requestedBy: request.requestedBy ?? null,
                  requestedByEmail: request.requestedBy
                    ? ((await organizationDirectory.member(request.id, request.requestedBy))
                        ?.email ?? null)
                    : null,
                  requestedAt: new Date(request.createdAt).toISOString(),
                })),
              ),
            };
          }),

        review: builder.organizationRequests.review
          .use(auth.requireAdmin)
          .handler(async ({ context, input }) => {
            const reviewed = await asAdmin(context.reqHeaders).reviewOrganization(input);
            return { id: reviewed.id, status: reviewed.status };
          }),
      },

      assignments: {
        list: builder.assignments.list.use(member).handler(async ({ context, input }) => {
          const { assignments } = Context.get(context["effect/context"], ApiServices);
          return runEffect(assignments.list(context.scope, input.projectId));
        }),

        listAll: builder.assignments.listAll.use(member).handler(async ({ context }) => {
          const { assignments } = Context.get(context["effect/context"], ApiServices);
          return runEffect(assignments.listAll(context.scope));
        }),

        create: builder.assignments.create.use(member).handler(async ({ context, input }) => {
          const { assignments } = Context.get(context["effect/context"], ApiServices);
          return runEffect(assignments.create(context.scope, input));
        }),

        delete: builder.assignments.delete.use(member).handler(async ({ context, input }) => {
          const { assignments } = Context.get(context["effect/context"], ApiServices);
          return runEffect(assignments.delete(context.scope, input));
        }),
      },

      workOrders: {
        list: builder.workOrders.list.use(agencyMember).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.list(context.scope, input);
        }),

        needsYouCount: builder.workOrders.needsYouCount
          .use(agencyMember)
          .handler(async ({ context }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.needsYouCount(context.scope);
          }),

        get: builder.workOrders.get.use(agencyMember).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.get(context.scope, input);
        }),

        activity: builder.workOrders.activity
          .use(agencyMember)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.activity(context.scope, input);
          }),

        create: builder.workOrders.create.use(agencyManager).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.create(context.scope, input);
        }),

        update: builder.workOrders.update.use(agencyManager).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.update(context.scope, input);
        }),

        delete: builder.workOrders.delete.use(agencyManager).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.remove(context.scope, input);
        }),

        nextCode: builder.workOrders.nextCode.use(agencyManager).handler(async ({ context }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.nextCode(context.scope);
        }),

        offer: builder.workOrders.offer.use(agencyManager).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.offer(context.scope, input);
        }),

        document: builder.workOrders.document
          .use(agencyMember)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.document(context.scope, input);
          }),

        countersign: builder.workOrders.countersign
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.countersign(context.scope, input, signerMeta(context.reqHeaders));
          }),

        activate: builder.workOrders.activate
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.activate(context.scope, input);
          }),

        terminate: builder.workOrders.terminate
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.terminate(context.scope, input);
          }),

        attachDocument: builder.workOrders.attachDocument
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.attachDocument(context.scope, input);
          }),

        collect: builder.workOrders.collect
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.collect(context.scope, input);
          }),

        draftRequest: builder.workOrders.draftRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.draftRequest(context.scope, input);
          }),

        approveRequest: builder.workOrders.approveRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.approveRequest(context.scope, input);
          }),

        payoutReadiness: builder.workOrders.payoutReadiness
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.payoutReadiness(context.scope, input);
          }),

        payoutCoverage: builder.workOrders.payoutCoverage
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.payoutCoverage(context.scope, input);
          }),

        rejectRequest: builder.workOrders.rejectRequest
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.rejectRequest(context.scope, input);
          }),

        linkProposal: builder.workOrders.linkProposal
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.linkProposal(context.scope, input);
          }),

        paymentProposal: builder.workOrders.paymentProposal
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.paymentProposal(context.scope, input);
          }),

        startDaoPayment: builder.workOrders.startDaoPayment
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.startDaoPayment(context.scope, input);
          }),

        payNow: builder.workOrders.payNow.use(agencyManager).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.payNow(context.scope, input);
        }),

        stopAutoApproval: builder.workOrders.stopAutoApproval
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.stopAutoApproval(context.scope, input);
          }),

        trustSettings: builder.workOrders.trustSettings
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.trustSettings(context.scope);
          }),

        saveTrustSettings: builder.workOrders.saveTrustSettings
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrderIntegrations, workOrders } = Context.get(
              context["effect/context"],
              ApiServices,
            );
            await workOrderIntegrations.saveTrust(
              context.scope.organizationId,
              context.scope.actorId,
              input,
            );
            return workOrders.trustSettings(context.scope);
          }),

        representativeDefaults: builder.workOrders.representativeDefaults
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { workOrderIntegrations } = Context.get(context["effect/context"], ApiServices);
            return workOrderIntegrations.representative(context.scope.organizationId);
          }),

        saveRepresentativeDefaults: builder.workOrders.saveRepresentativeDefaults
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrderIntegrations } = Context.get(context["effect/context"], ApiServices);
            await workOrderIntegrations.saveRepresentative(
              context.scope.organizationId,
              context.scope.actorId,
              input,
            );
            return workOrderIntegrations.representative(context.scope.organizationId);
          }),

        setupStatus: builder.workOrders.setupStatus
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { workOrderSetup } = Context.get(context["effect/context"], ApiServices);
            return workOrderSetup.checks(context.scope);
          }),

        payoutAgent: builder.workOrders.payoutAgent
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { payoutAgents } = Context.get(context["effect/context"], ApiServices);
            return payoutAgents.view(context.scope.organizationId);
          }),

        savePayoutAgent: builder.workOrders.savePayoutAgent
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { payoutAgents } = Context.get(context["effect/context"], ApiServices);
            return payoutAgents.saveSettings(
              context.scope.organizationId,
              context.scope.actorId,
              input,
            );
          }),

        preparePayoutAction: builder.workOrders.preparePayoutAction
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { payoutAgents, signedInNearKeys } = Context.get(
              context["effect/context"],
              ApiServices,
            );
            return payoutAgents.prepare(context.scope.organizationId, {
              ...input,
              signedInKeys:
                input.action === "create_agent"
                  ? await signedInNearKeys(context.userId)
                  : undefined,
            });
          }),

        submitPayoutAction: builder.workOrders.submitPayoutAction
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { payoutAgents } = Context.get(context["effect/context"], ApiServices);
            return payoutAgents.submit(context.scope.organizationId, input);
          }),

        allowPayees: builder.workOrders.allowPayees
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { payoutAgents } = Context.get(context["effect/context"], ApiServices);
            const result = await payoutAgents.ensurePayees(context.scope.organizationId);
            return { ...result, view: await payoutAgents.view(context.scope.organizationId) };
          }),

        payoutFunding: builder.workOrders.payoutFunding
          .use(treasuryManager)
          .handler(async ({ context }) => {
            const { workOrders, payoutAgents } = Context.get(
              context["effect/context"],
              ApiServices,
            );
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
            const { payoutAgents } = Context.get(context["effect/context"], ApiServices);
            const deposit = await payoutAgents.depositAddress(context.scope.organizationId);
            return {
              address: deposit.address,
              memo: deposit.memo,
              minAmount: deposit.minAmount,
              daoAccountId: context.scope.agencyDao,
              method: "add_proposal" as const,
              args: {
                proposal: topUpProposal({
                  daoAccountId: context.scope.agencyDao,
                  depositAddress: deposit.address,
                  memo: deposit.memo,
                  amount: BigInt(nearToAtomic(input.amountNear)),
                  amountNear: input.amountNear,
                }),
              },
              deposit: await getProposalBond(context.scope.agencyDao),
              gas: "100000000000000",
            };
          }),

        refreshPayment: builder.workOrders.refreshPayment
          .use(agencyMember)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.refreshPayment(context.scope, input);
          }),

        decideRenewal: builder.workOrders.decideRenewal
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.decideRenewal(context.scope, input);
          }),

        setGithubLogin: builder.workOrders.setGithubLogin
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.setGithubLogin(context.scope, input);
          }),

        prepareDocument: builder.workOrders.prepareDocument
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.prepareDocument(context.scope, input);
          }),

        requestPayeeConfirmation: builder.workOrders.requestPayeeConfirmation
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.requestPayeeConfirmation(context.scope, input);
          }),

        integration: builder.workOrders.integration
          .use(agencyManager)
          .handler(async ({ context }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            return integrationView(services, context.scope.organizationId);
          }),

        saveGoogle: builder.workOrders.saveGoogle
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { workOrderIntegrations } = services;
            const organizationId = context.scope.organizationId;
            const templateId = await checkGoogleFile(
              services,
              organizationId,
              "Template",
              input.templateUrl,
              "document",
            );
            const documentsFolderId = await checkGoogleFile(
              services,
              organizationId,
              "Documents folder",
              input.documentsFolderUrl,
              "folder",
              true,
            );
            const signedFolderId = await checkGoogleFile(
              services,
              organizationId,
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
            return integrationView(services, context.scope.organizationId);
          }),

        saveSignedToDrive: builder.workOrders.saveSignedToDrive
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.saveSignedToDrive(context.scope, input);
          }),

        connectGoogle: builder.workOrders.connectGoogle
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { googleConnections } = Context.get(context["effect/context"], ApiServices);
            return googleCall(async () => ({
              url: await googleConnections.start(
                context.scope.organizationId,
                context.scope.actorId,
              ),
            }));
          }),

        disconnectGoogle: builder.workOrders.disconnectGoogle
          .use(agencyManager)
          .handler(async ({ context }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { googleConnections } = services;
            await googleConnections.disconnect(context.scope.organizationId);
            return integrationView(services, context.scope.organizationId);
          }),

        googlePickerToken: builder.workOrders.googlePickerToken
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { googleConnections } = Context.get(context["effect/context"], ApiServices);
            return googleCall(async () => {
              const picker = googleConnections.picker;
              if (!picker) throw new GoogleSetupError("The Google Drive picker isn't set up");
              const { token, expiresAt } = await googleConnections.accessToken(
                context.scope.organizationId,
              );
              return {
                accessToken: token,
                expiresAt: new Date(expiresAt).toISOString(),
                apiKey: picker.apiKey,
                clientId: picker.clientId,
                appId: picker.appId,
              };
            });
          }),

        scanTemplate: builder.workOrders.scanTemplate
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { googleSetup } = Context.get(context["effect/context"], ApiServices);
            return googleCall(() => googleSetup.scan(context.scope.organizationId, input));
          }),

        saveTemplateFields: builder.workOrders.saveTemplateFields
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { googleSetup } = services;
            await googleCall(() =>
              googleSetup.saveFieldMap(
                context.scope.organizationId,
                context.scope.actorId,
                input.map,
              ),
            );
            return integrationView(services, context.scope.organizationId);
          }),

        previewTemplate: builder.workOrders.previewTemplate
          .use(agencyManager)
          .handler(async ({ context }) => {
            const { googleSetup } = Context.get(context["effect/context"], ApiServices);
            return googleCall(() => googleSetup.preview(context.scope.organizationId));
          }),

        applyTemplateFields: builder.workOrders.applyTemplateFields
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { googleSetup } = services;
            const { url } = await googleCall(() =>
              googleSetup.applyFields(
                context.scope.organizationId,
                context.scope.actorId,
                input.spots,
              ),
            );
            return { ...(await integrationView(services, context.scope.organizationId)), url };
          }),

        copyStarterTemplate: builder.workOrders.copyStarterTemplate
          .use(agencyManager)
          .handler(async ({ context }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { googleSetup } = services;
            const { url } = await googleCall(() =>
              googleSetup.copyStarter(context.scope.organizationId, context.scope.actorId),
            );
            return { ...(await integrationView(services, context.scope.organizationId)), url };
          }),

        googleCallback: builder.workOrders.googleCallback.handler(async ({ context, input }) => {
          const { appOrigin, googleConnections } = Context.get(
            context["effect/context"],
            ApiServices,
          );
          const back = (params: Record<string, string>) =>
            `${appOrigin}/admin/settings?${new URLSearchParams(params)}#work-orders`;
          try {
            await googleConnections.finish(input, context.userId ? actorOf(context) : null);
            return { headers: { location: back({ google: "connected" }) } };
          } catch (error) {
            const message =
              error instanceof GoogleConnectError || error instanceof GoogleError
                ? error.message
                : "Google Drive couldn't be connected. Try again";
            if (!(error instanceof GoogleConnectError)) {
              console.warn(`[API] Google connect failed: ${errorMessage(error)}`);
            }
            return { headers: { location: back({ google: "error", message }) } };
          }
        }),

        checkDrive: builder.workOrders.checkDrive
          .use(agencyManager)
          .handler(async ({ context }) => {
            const services = Context.get(context["effect/context"], ApiServices);
            const { workOrders } = services;
            const result = await workOrders.checkDrive(context.scope);
            return { ...(await integrationView(services, context.scope.organizationId)), result };
          }),

        run: builder.workOrders.run.handler(async ({ context }) => {
          const { workOrdersRunSecret, workOrders } = Context.get(
            context["effect/context"],
            ApiServices,
          );
          const given = context.reqHeaders?.get("authorization") ?? "";
          if (!workOrdersRunSecret || !sameSecret(given, `Bearer ${workOrdersRunSecret}`)) {
            throw new ORPCError("UNAUTHORIZED", { message: "A valid run secret is required" });
          }
          return workOrders.run();
        }),
      },

      myWorkOrders: {
        list: builder.myWorkOrders.list.use(auth.requireAuth).handler(async ({ context }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.mine(context);
        }),

        get: builder.myWorkOrders.get.use(auth.requireAuth).handler(async ({ context, input }) => {
          const { workOrders } = Context.get(context["effect/context"], ApiServices);
          return workOrders.mineGet(context, input);
        }),

        document: builder.myWorkOrders.document
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.myDocument(context, input);
          }),

        sign: builder.myWorkOrders.sign
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.sign(context, input, signerMeta(context.reqHeaders));
          }),

        confirmPayee: builder.myWorkOrders.confirmPayee
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.confirmPayee(context, input);
          }),

        decline: builder.myWorkOrders.decline
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.decline(context, input);
          }),

        draftRequest: builder.myWorkOrders.draftRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.mineDraftRequest(context, input);
          }),

        editRequest: builder.myWorkOrders.editRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.editRequest(context, input);
          }),

        submitRequest: builder.myWorkOrders.submitRequest
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { workOrders } = Context.get(context["effect/context"], ApiServices);
            return workOrders.submitRequest(context, input);
          }),
      },

      agreements: {
        list: builder.agreements.list.use(agencyMember).handler(async ({ context, input }) => {
          const { agreements } = Context.get(context["effect/context"], ApiServices);
          return agreements.list(context.scope, input);
        }),

        create: builder.agreements.create.use(agencyManager).handler(async ({ context, input }) => {
          const { agreements } = Context.get(context["effect/context"], ApiServices);
          return agreements.create(context.scope, input);
        }),

        update: builder.agreements.update.use(agencyManager).handler(async ({ context, input }) => {
          const { agreements } = Context.get(context["effect/context"], ApiServices);
          return agreements.update(context.scope, input);
        }),

        delete: builder.agreements.delete.use(agencyManager).handler(async ({ context, input }) => {
          const { agreements } = Context.get(context["effect/context"], ApiServices);
          return agreements.remove(context.scope, input);
        }),
      },

      budgets: {
        list: builder.budgets.list.use(treasuryMember).handler(async ({ context, input }) => {
          const { budgets } = Context.get(context["effect/context"], ApiServices);
          return runEffect(budgets.list(context.scope, input));
        }),

        create: builder.budgets.create.use(treasuryManager).handler(async ({ context, input }) => {
          const { budgets } = Context.get(context["effect/context"], ApiServices);
          return runEffect(budgets.create(context.scope, input));
        }),

        deallocate: builder.budgets.deallocate
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const { budgets } = Context.get(context["effect/context"], ApiServices);
            return runEffect(budgets.deallocate(context.scope, input));
          }),

        transfer: builder.budgets.transfer
          .use(treasuryManager)
          .handler(async ({ context, input }) => {
            const { budgets } = Context.get(context["effect/context"], ApiServices);
            return runEffect(budgets.transfer(context.scope, input));
          }),

        update: builder.budgets.update.use(treasuryManager).handler(async ({ context, input }) => {
          const { budgets } = Context.get(context["effect/context"], ApiServices);
          return runEffect(budgets.update(context.scope, input));
        }),

        delete: builder.budgets.delete.use(treasuryManager).handler(async ({ context, input }) => {
          const { budgets } = Context.get(context["effect/context"], ApiServices);
          return runEffect(budgets.remove(context.scope, input));
        }),

        deleted: builder.budgets.deleted.use(treasuryMember).handler(async ({ context, input }) => {
          const { budgets } = Context.get(context["effect/context"], ApiServices);
          return runEffect(budgets.listDeleted(context.scope, input));
        }),
      },

      billings: {
        list: builder.billings.list.use(treasuryMember).handler(async ({ context, input }) => {
          const { billings } = Context.get(context["effect/context"], ApiServices);
          return runEffect(billings.list(context.scope, input));
        }),

        create: builder.billings.create.use(treasuryManager).handler(async ({ context, input }) => {
          const { billings } = Context.get(context["effect/context"], ApiServices);
          return runEffect(billings.create(context.scope, input));
        }),

        delete: builder.billings.delete.use(treasuryManager).handler(async ({ context, input }) => {
          const { billings } = Context.get(context["effect/context"], ApiServices);
          return runEffect(billings.delete(context.scope, input));
        }),
      },

      proposals: {
        list: builder.proposals.list.handler(async ({ context, input }) => {
          const { proposals, access } = Context.get(context["effect/context"], ApiServices);
          return runEffect(proposals.list(await access.publicTreasuryScope(context), input));
        }),

        getPublicSummary: builder.proposals.getPublicSummary.handler(async ({ context }) => {
          const { proposals, access } = Context.get(context["effect/context"], ApiServices);
          return runEffect(proposals.getPublicSummary(await access.publicScope(context)));
        }),
      },

      community: {
        searchBuilders: builder.community.searchBuilders
          .use(agencyMember)
          .handler(async ({ input, context }) => {
            const { community } = Context.get(context["effect/context"], ApiServices);
            return community.searchBuilders(input);
          }),

        searchProjects: builder.community.searchProjects
          .use(agencyMember)
          .handler(async ({ input, context }) => {
            const { community } = Context.get(context["effect/context"], ApiServices);
            return community.searchProjects(input);
          }),
      },

      nearn: {
        getListing: builder.nearn.getListing
          .use(agencyMember)
          .handler(async ({ context, input }) => {
            const { nearn } = Context.get(context["effect/context"], ApiServices);
            return runEffect(nearn.getListing(context.scope, input));
          }),

        listSponsorBounties: builder.nearn.listSponsorBounties
          .use(agencyMember)
          .handler(async ({ context }) => {
            const { nearn } = Context.get(context["effect/context"], ApiServices);
            return runEffect(nearn.listSponsorBounties(context.scope));
          }),

        listSubmissions: builder.nearn.listSubmissions
          .use(agencyMember)
          .handler(async ({ context, input }) => {
            const { nearn } = Context.get(context["effect/context"], ApiServices);
            return runEffect(nearn.listSubmissions(context.scope, input));
          }),
      },

      tokens: {
        list: builder.tokens.list.handler(async ({ context }) => {
          const { tokens, access } = Context.get(context["effect/context"], ApiServices);
          return runEffect(tokens.list(await access.publicScope(context)));
        }),

        listOwned: builder.tokens.listOwned.use(treasuryMember).handler(async ({ context }) => {
          const { tokens } = Context.get(context["effect/context"], ApiServices);
          return runEffect(tokens.list(context.scope));
        }),

        getStorageStatus: builder.tokens.getStorageStatus.handler(async ({ context, input }) => {
          const { tokens, access } = Context.get(context["effect/context"], ApiServices);
          return runEffect(tokens.getStorageStatus(await access.publicScope(context), input));
        }),
      },

      treasury: {
        getPublicBalances: builder.treasury.getPublicBalances.handler(
          async ({ context, input }) => {
            const { treasury, access } = Context.get(context["effect/context"], ApiServices);
            return runEffect(treasury.getPublicBalances(await access.publicScope(context), input));
          },
        ),

        getBalances: builder.treasury.getBalances
          .use(treasuryMember)
          .handler(async ({ context, input }) => {
            const { treasury } = Context.get(context["effect/context"], ApiServices);
            return runEffect(treasury.getBalances(context.scope, input));
          }),

        getRollups: builder.treasury.getRollups.use(treasuryMember).handler(async ({ context }) => {
          const { treasury } = Context.get(context["effect/context"], ApiServices);
          return runEffect(treasury.getRollups(context.scope));
        }),

        getPublicSummary: builder.treasury.getPublicSummary.handler(async ({ context }) => {
          const { treasury, access } = Context.get(context["effect/context"], ApiServices);
          return runEffect(treasury.getPublicSummary(await access.publicScope(context)));
        }),
      },

      me: {
        roles: builder.me.roles.use(auth.requireAuth).handler(async ({ context }) => {
          const { access } = Context.get(context["effect/context"], ApiServices);
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
          .handler(async ({ context }) => {
            const { me } = Context.get(context["effect/context"], ApiServices);
            return me.assignedProjects(context);
          }),

        billings: builder.me.billings.use(auth.requireAuth).handler(async ({ context, input }) => {
          const { me } = Context.get(context["effect/context"], ApiServices);
          return me.billings(context, input);
        }),

        organizations: builder.me.organizations
          .use(auth.requireAuth)
          .handler(async ({ context }) => {
            const { organizationDirectory } = Context.get(context["effect/context"], ApiServices);
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
        get: builder.agencyDao.get.use(manager).handler(async ({ context }) => {
          const { agencyDaos } = Context.get(context["effect/context"], ApiServices);
          return agencyDaos.status(context.scope);
        }),

        connect: builder.agencyDao.connect
          .use(auth.requireAuth)
          .handler(async ({ context, input }) => {
            const { agencyDaos, access } = Context.get(context["effect/context"], ApiServices);
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

        disconnect: builder.agencyDao.disconnect.use(manager).handler(async ({ context }) => {
          const { agencyDaos } = Context.get(context["effect/context"], ApiServices);
          return agencyDaos.disconnect(context.scope);
        }),
      },

      team: {
        list: builder.team.list.handler(async ({ context }) => {
          const { access } = Context.get(context["effect/context"], ApiServices);
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
          const { db, access } = Context.get(context["effect/context"], ApiServices);
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

        get: builder.agencyConfig.get.use(agencyManager).handler(async ({ context }) => {
          const { db } = Context.get(context["effect/context"], ApiServices);
          return getAdminSettings(db, context.scope, getNetwork(context.reqHeaders));
        }),

        update: builder.agencyConfig.update
          .use(agencyManager)
          .handler(async ({ context, input }) => {
            const { db } = Context.get(context["effect/context"], ApiServices);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function googleCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof GoogleSetupError ||
      error instanceof GoogleConnectError ||
      error instanceof GoogleError
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
        data: { reason: "GOOGLE_FAILED" },
      });
    }
    throw error;
  }
}

function sameSecret(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
