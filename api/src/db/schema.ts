import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["founder", "contributor", "client"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    nearAccountId: text("near_account_id"),
    message: text("message"),
    metadata: text("metadata"),
    status: text("status", {
      enum: ["new", "reviewing", "accepted", "declined", "converted"],
    })
      .notNull()
      .default("new"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("applications_cursor").on(t.createdAt, t.id),
  }),
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

// Listings keyed to upstream project id; NEARN-sourced rows are a lazy-refresh cache from nearn.io.
export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    source: text("source", { enum: ["nearn", "internal"] }).notNull(),
    externalId: text("external_id"),
    externalUuid: text("external_uuid"),
    title: text("title"),
    description: text("description"),
    type: text("type"),
    status: text("status"),
    token: text("token"),
    rewardAmount: text("reward_amount"),
    compensationType: text("compensation_type"),
    minRewardAsk: text("min_reward_ask"),
    maxRewardAsk: text("max_reward_ask"),
    totalPaymentsMade: integer("total_payments_made"),
    totalWinnersSelected: integer("total_winners_selected"),
    submissionLimit: text("submission_limit"),
    rewards: text("rewards"),
    maxBonusSpots: integer("max_bonus_spots"),
    usdValue: text("usd_value"),
    skills: text("skills"),
    region: text("region"),
    applicationType: text("application_type"),
    multipleSubmissionRule: text("multiple_submission_rule"),
    timeToComplete: text("time_to_complete"),
    requirements: text("requirements"),
    sequentialId: integer("sequential_id"),
    nearnPublishedAt: timestamp("nearn_published_at", { withTimezone: false }),
    deadline: timestamp("deadline", { withTimezone: false }),
    isPublished: boolean("is_published"),
    isArchived: boolean("is_archived"),
    isFeatured: boolean("is_featured"),
    isPrivate: boolean("is_private"),
    isWinnersAnnounced: boolean("is_winners_announced"),
    isHackathonPrize: boolean("is_hackathon_prize"),
    hackathonSlug: text("hackathon_slug"),
    hackathonName: text("hackathon_name"),
    hackathonStartDate: timestamp("hackathon_start_date", { withTimezone: false }),
    hackathonAnnounceDate: timestamp("hackathon_announce_date", { withTimezone: false }),
    sponsorName: text("sponsor_name"),
    sponsorSlug: text("sponsor_slug"),
    sponsorLogo: text("sponsor_logo"),
    sponsorVerified: boolean("sponsor_verified"),
    sponsorEntityName: text("sponsor_entity_name"),
    sponsorIsCaution: boolean("sponsor_is_caution"),
    syncedAt: timestamp("synced_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    projectIdx: index("listings_project_id").on(t.projectId),
    projectSourceUnique: uniqueIndex("listings_project_source").on(t.projectId, t.source),
    sourceExternalIdUnique: uniqueIndex("listings_source_external_id")
      .on(t.source, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  }),
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

export const organizationDaos = pgTable(
  "organization_daos",
  {
    organizationId: text("organization_id").primaryKey(),
    daoAccountId: text("dao_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    daoUnique: uniqueIndex("organization_daos_dao_unique").on(t.daoAccountId),
  }),
);

export const ENGAGEMENT_STATUSES = ["proposed", "active", "declined", "ended"] as const;
export const ENGAGEMENT_KINDS = ["client", "subcontract"] as const;

export const engagements = pgTable(
  "engagements",
  {
    id: text("id").primaryKey(),
    agencyOrganizationId: text("agency_organization_id").notNull(),
    clientOrganizationId: text("client_organization_id").notNull(),
    kind: text("kind", { enum: ENGAGEMENT_KINDS }).notNull().default("client"),
    status: text("status", { enum: ENGAGEMENT_STATUSES }).notNull(),
    proposedBy: text("proposed_by").notNull(),
    invitationId: text("invitation_id"),
    invitationAcceptedAt: timestamp("invitation_accepted_at", { withTimezone: false }),
    legacyClientId: text("legacy_client_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
    decidedAt: timestamp("decided_at", { withTimezone: false }),
    endedAt: timestamp("ended_at", { withTimezone: false }),
  },
  (t) => ({
    activePair: uniqueIndex("engagements_active_pair")
      .on(t.agencyOrganizationId, t.clientOrganizationId)
      .where(sql`${t.status} = 'active'`),
    proposedPair: uniqueIndex("engagements_proposed_pair")
      .on(t.agencyOrganizationId, t.clientOrganizationId)
      .where(sql`${t.status} = 'proposed'`),
    legacyClient: uniqueIndex("engagements_legacy_client")
      .on(t.legacyClientId)
      .where(sql`${t.legacyClientId} IS NOT NULL`),
    agencyIdx: index("engagements_agency").on(t.agencyOrganizationId),
    clientIdx: index("engagements_client").on(t.clientOrganizationId),
  }),
);

export type EngagementRow = typeof engagements.$inferSelect;

export const engagementProjects = pgTable(
  "engagement_projects",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.engagementId, t.projectId] }),
    projectIdx: index("engagement_projects_project_id").on(t.projectId),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientUserId: text("recipient_user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    recipientIdx: index("notifications_recipient").on(t.recipientUserId, t.createdAt, t.id),
  }),
);

export type NotificationRow = typeof notifications.$inferSelect;

export const projectContributors = pgTable(
  "project_contributors",
  {
    projectId: text("project_id").notNull(),
    nearAccount: text("near_account").notNull(),
    role: text("role"),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
    organizationId: text("organization_id"),
    assignedByOrganizationId: text("assigned_by_organization_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.nearAccount] }),
    nearAccountIdx: index("project_contributors_near_account").on(t.nearAccount),
  }),
);

export const AGREEMENT_KINDS = ["retainer", "project"] as const;

export const clientAgreements = pgTable(
  "client_agreements",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    kind: text("kind", { enum: AGREEMENT_KINDS }).notNull(),
    title: text("title").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    tokenId: text("token_id").notNull(),
    agreedAmount: text("agreed_amount").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("client_agreements_engagement").on(t.engagementId, t.startDate),
  }),
);

export type ClientAgreement = typeof clientAgreements.$inferSelect;

export const budgets = pgTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    note: text("note"),
    actorAccountId: text("actor_account_id").notNull(),
    relatedBudgetId: text("related_budget_id"),
    engagementId: text("engagement_id").references(() => engagements.id, {
      onDelete: "set null",
    }),
    fundingDaoAccountId: text("funding_dao_account_id"),
    effectiveOn: date("effective_on"),
    agreementId: text("agreement_id").references(() => clientAgreements.id),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    agreementIdx: index("budgets_agreement_id").on(t.agreementId),
    cursor: index("budgets_cursor").on(t.createdAt, t.id),
    projectIdx: index("budgets_project_id").on(t.projectId),
    engagementIdx: index("budgets_engagement_id").on(t.engagementId),
    fundingDaoIdx: index("budgets_funding_dao").on(t.fundingDaoAccountId),
  }),
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

export const budgetRevisions = pgTable(
  "budget_revisions",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id").notNull(),
    action: text("action", { enum: ["edited", "deleted"] }).notNull(),
    projectId: text("project_id").notNull(),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    note: text("note"),
    effectiveOn: date("effective_on"),
    relatedBudgetId: text("related_budget_id"),
    engagementId: text("engagement_id"),
    fundingDaoAccountId: text("funding_dao_account_id"),
    agreementId: text("agreement_id"),
    actorAccountId: text("actor_account_id").notNull(),
    budgetCreatedAt: timestamp("budget_created_at", { withTimezone: false }).notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    budgetIdx: index("budget_revisions_budget").on(t.budgetId),
    projectIdx: index("budget_revisions_project").on(t.projectId, t.changedAt),
  }),
);

export type BudgetRevision = typeof budgetRevisions.$inferSelect;

export const prepayments = pgTable(
  "prepayments",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    daoAccountId: text("dao_account_id").notNull(),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    period: text("period").notNull(),
    transferReference: text("transfer_reference"),
    actorAccountId: text("actor_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("prepayments_engagement").on(t.engagementId, t.period),
    daoIdx: index("prepayments_dao").on(t.daoAccountId),
  }),
);

export type PrepaymentRow = typeof prepayments.$inferSelect;

export const CHANGE_ORDER_STATUSES = [
  "proposed",
  "approved",
  "applied",
  "rejected",
  "withdrawn",
  "failed",
] as const;
export const CHANGE_ORDER_EFFECTS = ["next_period", "now"] as const;
export const CHANGE_ORDER_ITEM_KINDS = ["plan_change", "one_off_move"] as const;

export const changeOrders = pgTable(
  "change_orders",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    proposedByOrganizationId: text("proposed_by_organization_id").notNull(),
    proposedByUserId: text("proposed_by_user_id").notNull(),
    status: text("status", { enum: CHANGE_ORDER_STATUSES }).notNull(),
    effective: text("effective", { enum: CHANGE_ORDER_EFFECTS }).notNull(),
    effectivePeriod: text("effective_period"),
    note: text("note"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: false }),
    appliedAt: timestamp("applied_at", { withTimezone: false }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("change_orders_engagement").on(t.engagementId, t.createdAt),
  }),
);

export type ChangeOrderRow = typeof changeOrders.$inferSelect;

export const changeOrderItems = pgTable(
  "change_order_items",
  {
    id: text("id").primaryKey(),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => changeOrders.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    projectId: text("project_id"),
    tokenId: text("token_id").notNull(),
    kind: text("kind", { enum: CHANGE_ORDER_ITEM_KINDS }).notNull(),
    amount: text("amount").notNull(),
  },
  (t) => ({
    changeOrderIdx: index("change_order_items_change_order").on(t.changeOrderId, t.position),
  }),
);

export type ChangeOrderItemRow = typeof changeOrderItems.$inferSelect;

export const allocationPlanLines = pgTable(
  "allocation_plan_lines",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    projectId: text("project_id").notNull(),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    position: integer("position").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => changeOrders.id),
    supersededBy: text("superseded_by").references(() => changeOrders.id),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("allocation_plan_lines_engagement").on(t.engagementId, t.position),
    current: uniqueIndex("allocation_plan_lines_current")
      .on(t.engagementId, t.projectId, t.tokenId)
      .where(sql`${t.supersededBy} IS NULL`),
  }),
);

export type AllocationPlanLineRow = typeof allocationPlanLines.$inferSelect;

export const allocationPlanApplications = pgTable(
  "allocation_plan_applications",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    period: text("period").notNull(),
    prepaymentId: text("prepayment_id"),
    shortfall: text("shortfall").notNull().default("[]"),
    appliedAt: timestamp("applied_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.engagementId, t.period] }),
  }),
);

export type AllocationPlanApplicationRow = typeof allocationPlanApplications.$inferSelect;

export const billings = pgTable(
  "billings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    nearAccount: text("near_account"),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    proposalId: text("proposal_id").notNull(),
    payingDaoAccountId: text("paying_dao_account_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("billings_cursor").on(t.createdAt, t.id),
    payingDaoProposalUnique: uniqueIndex("billings_paying_dao_proposal_unique").on(
      t.payingDaoAccountId,
      t.proposalId,
    ),
    projectIdx: index("billings_project_id").on(t.projectId),
    nearAccountIdx: index("billings_near_account").on(t.nearAccount),
  }),
);

export type Billing = typeof billings.$inferSelect;
export type NewBilling = typeof billings.$inferInsert;

export const proposals = pgTable(
  "proposals",
  {
    daoAccountId: text("dao_account_id").notNull(),
    proposalId: integer("proposal_id").notNull(),
    proposer: text("proposer").notNull(),
    description: text("description").notNull(),
    status: text("status", {
      enum: ["Approved", "Rejected", "Removed", "Expired", "Moved", "Failed"],
    }).notNull(),
    kindType: text("kind_type", { enum: ["Transfer", "Other"] }).notNull(),
    transferTokenId: text("transfer_token_id"),
    transferReceiverId: text("transfer_receiver_id"),
    transferAmount: text("transfer_amount"),
    otherKindName: text("other_kind_name"),
    submissionTime: text("submission_time").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.daoAccountId, t.proposalId] }),
  }),
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

export const settings = pgTable("settings", {
  orgAccountId: text("org_account_id").primaryKey(),
  daoAccountId: text("dao_account_id"),
  nearnAccountId: text("nearn_account_id"),
  websiteUrl: text("website_url"),
  docsUrl: text("docs_url"),
  description: text("description"),
  contactEmail: text("contact_email"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;

export const IDEA_STATUSES = ["new", "accepted", "declined"] as const;

export const ideas = pgTable(
  "ideas",
  {
    projectId: text("project_id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    status: text("status", { enum: IDEA_STATUSES }).notNull().default("new"),
    resultProjectId: text("result_project_id"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("ideas_engagement").on(t.engagementId, t.createdAt),
  }),
);

export type IdeaRow = typeof ideas.$inferSelect;

export const organizationBuilders = pgTable(
  "organization_builders",
  {
    organizationId: text("organization_id").notNull(),
    nearAccount: text("near_account").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.nearAccount] }),
    nearAccountIdx: index("organization_builders_near_account").on(t.nearAccount),
  }),
);

export const organizationBuilderLogins = pgTable(
  "organization_builder_logins",
  {
    organizationId: text("organization_id").notNull(),
    nearAccount: text("near_account").notNull(),
    githubLogin: text("github_login").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.nearAccount] }),
  }),
);

export const projectPublicSettings = pgTable("project_public_settings", {
  projectId: text("project_id").primaryKey(),
  showTeam: boolean("show_team").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export const agentLinks = pgTable(
  "agent_links",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id),
    label: text("label").notNull(),
    url: text("url").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("agent_links_engagement").on(t.engagementId, t.position),
  }),
);

export type AgentLinkRow = typeof agentLinks.$inferSelect;

export const reportSnapshots = pgTable(
  "report_snapshots",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    engagementId: text("engagement_id").references(() => engagements.id),
    generatedByUserId: text("generated_by_user_id").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    note: text("note"),
    payload: text("payload").notNull(),
    sharedAt: timestamp("shared_at", { withTimezone: false }),
    sharedByUserId: text("shared_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    organizationIdx: index("report_snapshots_organization").on(t.organizationId, t.createdAt, t.id),
    engagementSharedIdx: index("report_snapshots_engagement_shared").on(t.engagementId, t.sharedAt),
  }),
);

export type ReportSnapshotRow = typeof reportSnapshots.$inferSelect;

export const WORK_ORDER_STATUSES = [
  "draft",
  "offered",
  "accepted",
  "active",
  "ended",
  "exhausted",
  "terminated",
] as const;

export const RENEWAL_STATUSES = ["renewed", "needs_approval", "declined"] as const;

export const SIGNATURE_METHODS = ["in_app", "google_esign", "documenso"] as const;

export const workOrders = pgTable(
  "work_orders",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    projectTitle: text("project_title"),
    projectSlug: text("project_slug"),
    builderNearAccount: text("builder_near_account").notNull(),
    githubLogin: text("github_login"),
    title: text("title").notNull(),
    scope: text("scope"),
    repos: text("repos").notNull().default("[]"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    graceDays: integer("grace_days").notNull().default(2),
    tokenId: text("token_id").notNull(),
    budgetAmount: text("budget_amount").notNull(),
    payoutTokenId: text("payout_token_id"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    status: text("status", { enum: WORK_ORDER_STATUSES }).notNull().default("draft"),
    offeredAt: timestamp("offered_at", { withTimezone: false }),
    acceptedAt: timestamp("accepted_at", { withTimezone: false }),
    acceptedByUserId: text("accepted_by_user_id"),
    acceptedTermsHash: text("accepted_terms_hash"),
    contractorName: text("contractor_name"),
    contractorEmail: text("contractor_email"),
    representativeName: text("representative_name"),
    representativeEmail: text("representative_email"),
    ipModel: text("ip_model"),
    preparedDocumentUrl: text("prepared_document_url"),
    documentId: text("document_id"),
    documentFields: text("document_fields"),
    signatureMethod: text("signature_method", { enum: SIGNATURE_METHODS }),
    signers: text("signers"),
    signedAt: timestamp("signed_at", { withTimezone: false }),
    payeeConfirmedAt: timestamp("payee_confirmed_at", { withTimezone: false }),
    payeeConfirmedBy: text("payee_confirmed_by"),
    documentSha256: text("document_sha256"),
    documentUrl: text("document_url"),
    esignEnvelopeId: text("esign_envelope_id"),
    esignBuilderUrl: text("esign_builder_url"),
    esignRepresentativeUrl: text("esign_representative_url"),
    esignError: text("esign_error"),
    activatedAt: timestamp("activated_at", { withTimezone: false }),
    activatedBy: text("activated_by"),
    lastCollectedAt: timestamp("last_collected_at", { withTimezone: false }),
    endingSoonAt: timestamp("ending_soon_at", { withTimezone: false }),
    autoDraftedFor: date("auto_drafted_for"),
    renewedFrom: text("renewed_from"),
    renewalRoot: text("renewal_root"),
    renewalSeq: integer("renewal_seq").notNull().default(1),
    renewalStatus: text("renewal_status", { enum: RENEWAL_STATUSES }),
    renewalAssessment: text("renewal_assessment"),
    renewalDecidedBy: text("renewal_decided_by"),
    renewalDecidedAt: timestamp("renewal_decided_at", { withTimezone: false }),
    renewalNote: text("renewal_note"),
    renewedTo: text("renewed_to"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    organizationCode: uniqueIndex("work_orders_organization_code").on(t.organizationId, t.code),
    organizationStatus: index("work_orders_organization_status").on(t.organizationId, t.status),
    builderIdx: index("work_orders_builder").on(t.builderNearAccount),
    projectIdx: index("work_orders_project").on(t.projectId),
  }),
);

export type WorkOrderRow = typeof workOrders.$inferSelect;

export const EVIDENCE_KINDS = [
  "assigned_issue",
  "merged_pr",
  "unlinked_pr",
  "review",
  "manual",
] as const;

export const workOrderEvidence = pgTable(
  "work_order_evidence",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: EVIDENCE_KINDS }).notNull(),
    repo: text("repo"),
    number: integer("number"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: false }),
    assignedAt: timestamp("assigned_at", { withTimezone: false }),
    assignedBy: text("assigned_by"),
    authorized: boolean("authorized").notNull().default(false),
    confirmed: boolean("confirmed").notNull().default(false),
    flags: text("flags").notNull().default("[]"),
    links: text("links").notNull().default("[]"),
    details: text("details").notNull().default("{}"),
    collectedAt: timestamp("collected_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    unique: uniqueIndex("work_order_evidence_unique").on(t.workOrderId, t.kind, t.url),
  }),
);

export type WorkOrderEvidenceRow = typeof workOrderEvidence.$inferSelect;

export const COMPENSATION_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "paying",
  "proposed",
  "paid",
  "rejected",
  "failed",
] as const;

export const AUTO_DECISIONS = ["manual", "veto_window", "auto_pay"] as const;

export const TRUST_MODES = ["off", "suggest", "auto"] as const;

export const compensationRequests = pgTable(
  "compensation_requests",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    coversFrom: date("covers_from").notNull(),
    coversTo: date("covers_to").notNull(),
    status: text("status", { enum: COMPENSATION_REQUEST_STATUSES }).notNull().default("draft"),
    requestedAmount: text("requested_amount").notNull(),
    approvedAmount: text("approved_amount"),
    approvedBy: text("approved_by"),
    decidedAt: timestamp("decided_at", { withTimezone: false }),
    note: text("note"),
    summary: text("summary"),
    contributionsMd: text("contributions_md").notNull(),
    assessmentMd: text("assessment_md").notNull(),
    assessmentEdited: boolean("assessment_edited").notNull().default(false),
    manualItems: text("manual_items").notNull().default("[]"),
    evidenceIds: text("evidence_ids"),
    reportMd: text("report_md"),
    reportSha256: text("report_sha256"),
    billingId: text("billing_id").references(() => billings.id, { onDelete: "set null" }),
    payoutTokenId: text("payout_token_id"),
    payoutAmount: text("payout_amount"),
    priceUsd: text("price_usd"),
    pricedAt: timestamp("priced_at", { withTimezone: false }),
    proposalId: text("proposal_id"),
    autoPayBlockedReason: text("auto_pay_blocked_reason"),
    autoPayBlockedCode: text("auto_pay_blocked_code"),
    autoPayBlockedAt: timestamp("auto_pay_blocked_at", { withTimezone: false }),
    autoPayTriedAt: timestamp("auto_pay_tried_at", { withTimezone: false }),
    submittedAt: timestamp("submitted_at", { withTimezone: false }),
    paidAt: timestamp("paid_at", { withTimezone: false }),
    trust: text("trust"),
    autoApproveAt: timestamp("auto_approve_at", { withTimezone: false }),
    autoDecision: text("auto_decision", { enum: AUTO_DECISIONS }),
    autoStoppedBy: text("auto_stopped_by"),
    autoStoppedAt: timestamp("auto_stopped_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    sequence: uniqueIndex("compensation_requests_sequence").on(t.workOrderId, t.seq),
    statusIdx: index("compensation_requests_status").on(t.status),
    autoApproveIdx: index("compensation_requests_auto_approve_at").on(t.autoApproveAt),
  }),
);

export type CompensationRequestRow = typeof compensationRequests.$inferSelect;

export const workOrderJobLock = pgTable("work_order_job_lock", {
  id: text("id").primaryKey(),
  holder: text("holder").notNull(),
  until: timestamp("until", { withTimezone: false }).notNull(),
});

export const workOrderIntegrations = pgTable("work_order_integrations", {
  organizationId: text("organization_id").primaryKey(),
  googleTemplateId: text("google_template_id"),
  googleDocumentsFolderId: text("google_documents_folder_id"),
  googleSignedFolderId: text("google_signed_folder_id"),
  googleCheckedAt: timestamp("google_checked_at", { withTimezone: false }),
  googleLastError: text("google_last_error"),
  trustMode: text("trust_mode", { enum: TRUST_MODES }).notNull().default("suggest"),
  trustVetoHours: integer("trust_veto_hours").notNull().default(24),
  defaultRepresentativeName: text("default_representative_name"),
  defaultRepresentativeEmail: text("default_representative_email"),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type WorkOrderIntegrationRow = typeof workOrderIntegrations.$inferSelect;

export const workOrderOutbox = pgTable(
  "work_order_outbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    workOrderId: text("work_order_id"),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: false })
      .notNull()
      .default(sql`now()`),
    deliveredAt: timestamp("delivered_at", { withTimezone: false }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    due: index("work_order_outbox_due").on(t.deliveredAt, t.nextAttemptAt),
    organizationIdx: index("work_order_outbox_organization").on(t.organizationId, t.createdAt),
  }),
);

export type WorkOrderOutboxRow = typeof workOrderOutbox.$inferSelect;

export const DRIVE_FILE_OUTCOMES = ["attached", "mismatch", "unmatched", "error"] as const;

export const workOrderDriveFiles = pgTable(
  "work_order_drive_files",
  {
    fileId: text("file_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    sha256: text("sha256"),
    workOrderId: text("work_order_id"),
    outcome: text("outcome", { enum: DRIVE_FILE_OUTCOMES }).notNull(),
    note: text("note"),
    processedAt: timestamp("processed_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    organizationIdx: index("work_order_drive_files_organization").on(
      t.organizationId,
      t.processedAt,
    ),
  }),
);

export type WorkOrderDriveFileRow = typeof workOrderDriveFiles.$inferSelect;

export const WORK_ORDER_DOCUMENT_KINDS = ["offered", "signed"] as const;

export const workOrderDocuments = pgTable(
  "work_order_documents",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: WORK_ORDER_DOCUMENT_KINDS }).notNull(),
    fileName: text("file_name").notNull(),
    pdf: text("pdf").notNull(),
    sha256: text("sha256").notNull(),
    termsHash: text("terms_hash").notNull(),
    driveFileId: text("drive_file_id"),
    driveUrl: text("drive_url"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    workOrderIdx: index("work_order_documents_work_order").on(t.workOrderId, t.createdAt),
  }),
);

export type WorkOrderDocumentRow = typeof workOrderDocuments.$inferSelect;

export const SIGNER_ROLES = ["contractor", "representative"] as const;

export const workOrderSignatures = pgTable(
  "work_order_signatures",
  {
    id: text("id").primaryKey(),
    workOrderId: text("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    documentSha256: text("document_sha256").notNull(),
    role: text("role", { enum: SIGNER_ROLES }).notNull(),
    name: text("name").notNull(),
    email: text("email"),
    userId: text("user_id"),
    nearAccount: text("near_account"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    once: uniqueIndex("work_order_signatures_once").on(t.workOrderId, t.documentSha256, t.role),
  }),
);

export type WorkOrderSignatureRow = typeof workOrderSignatures.$inferSelect;

export const payoutAgents = pgTable("payout_agents", {
  organizationId: text("organization_id").primaryKey(),
  ownerAccountId: text("owner_account_id").notNull(),
  agentId: text("agent_id"),
  grantTokenEnc: text("grant_token_enc"),
  grantExpiresAt: timestamp("grant_expires_at", { withTimezone: false }),
  grantRemindedFor: timestamp("grant_reminded_for", { withTimezone: false }),
  monthlyBudgetUsd: text("monthly_budget_usd").notNull(),
  maxPayoutNear: text("max_payout_near").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type PayoutAgentRow = typeof payoutAgents.$inferSelect;

export const PAYOUT_ACTIONS = [
  "create_agent",
  "issue_grant",
  "sync_policy",
  "freeze",
  "unfreeze",
] as const;

export const payoutIntents = pgTable("payout_intents", {
  correlationId: text("correlation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  action: text("action", { enum: PAYOUT_ACTIONS }).notNull(),
  intentType: text("intent_type").notNull(),
  intent: text("intent").notNull(),
  signerAccountId: text("signer_account_id").notNull(),
  signerPublicKey: text("signer_public_key").notNull(),
  agentId: text("agent_id"),
  grantTokenEnc: text("grant_token_enc"),
  grantExpiresAt: timestamp("grant_expires_at", { withTimezone: false }),
  status: text("status").notNull(),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type PayoutIntentRow = typeof payoutIntents.$inferSelect;

export const AGENT_PAYOUT_STATUSES = [
  "sending",
  "queued",
  "processing",
  "paid",
  "failed",
  "refused",
  "uncertain",
  "needs_review",
] as const;

export const agentPayouts = pgTable(
  "agent_payouts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    requestId: text("request_id").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status", { enum: AGENT_PAYOUT_STATUSES }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestBody: text("request_body").notNull(),
    correlationId: text("correlation_id"),
    recipient: text("recipient").notNull(),
    amount: text("amount").notNull(),
    assetId: text("asset_id").notNull(),
    txHash: text("tx_hash"),
    txUrl: text("tx_url"),
    reason: text("reason"),
    provenUnsent: boolean("proven_unsent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    attempt: uniqueIndex("agent_payouts_attempt").on(t.requestId, t.attempt),
    statusIdx: index("agent_payouts_status").on(t.status),
  }),
);

export type AgentPayoutRow = typeof agentPayouts.$inferSelect;
