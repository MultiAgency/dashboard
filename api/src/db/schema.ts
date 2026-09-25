import { sql } from "drizzle-orm";
import {
  boolean,
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

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    agencyDaoAccountId: text("agency_dao_account_id").notNull(),
    name: text("name").notNull(),
    nearAccountId: text("near_account_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index("clients_org_id").on(t.orgId),
    agencyNearIdx: uniqueIndex("clients_agency_near_unique")
      .on(t.agencyDaoAccountId, t.nearAccountId)
      .where(sql`${t.nearAccountId} IS NOT NULL`),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

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

export const clientProjects = pgTable(
  "client_projects",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clientId, t.projectId] }),
    projectIdx: index("client_projects_project_id").on(t.projectId),
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
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    engagementId: text("engagement_id").references(() => engagements.id, {
      onDelete: "set null",
    }),
    fundingDaoAccountId: text("funding_dao_account_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("budgets_cursor").on(t.createdAt, t.id),
    projectIdx: index("budgets_project_id").on(t.projectId),
    clientIdx: index("budgets_client_id").on(t.clientId),
    engagementIdx: index("budgets_engagement_id").on(t.engagementId),
    fundingDaoIdx: index("budgets_funding_dao").on(t.fundingDaoAccountId),
  }),
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

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
