import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export const projectContributors = pgTable(
  "project_contributors",
  {
    projectId: text("project_id").notNull(),
    nearAccount: text("near_account").notNull(),
    role: text("role"),
    onboardingStatus: text("onboarding_status").notNull().default("pending"),
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
    daoAccountId: text("dao_account_id"),
    engagementId: text("engagement_id").references((): AnyPgColumn => engagements.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("budgets_cursor").on(t.createdAt, t.id),
    projectIdx: index("budgets_project_id").on(t.projectId),
    engagementIdx: index("budgets_engagement_id").on(t.engagementId),
  }),
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

export const billings = pgTable(
  "billings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    nearAccount: text("near_account"),
    daoAccountId: text("dao_account_id"),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    proposalId: text("proposal_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("billings_cursor").on(t.createdAt, t.id),
    proposalUnique: uniqueIndex("billings_proposal_unique").on(t.daoAccountId, t.proposalId),
    projectIdx: index("billings_project_id").on(t.projectId),
    daoIdx: index("billings_dao_account_id").on(t.daoAccountId),
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

export const engagements = pgTable(
  "engagements",
  {
    id: text("id").primaryKey(),
    agencyOrganizationId: text("agency_organization_id").notNull(),
    agencyName: text("agency_name").notNull().default(""),
    clientOrganizationId: text("client_organization_id").notNull(),
    clientName: text("client_name").notNull().default(""),
    kind: text("kind", { enum: ["client", "subcontract"] })
      .notNull()
      .default("client"),
    status: text("status", { enum: ["proposed", "active", "declined", "ended"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
    endedAt: timestamp("ended_at", { withTimezone: false }),
  },
  (t) => ({
    activePair: uniqueIndex("engagements_active_pair")
      .on(t.agencyOrganizationId, t.clientOrganizationId, t.kind)
      .where(sql`${t.status} = 'active'`),
    agencyIdx: index("engagements_agency").on(t.agencyOrganizationId),
    clientIdx: index("engagements_client").on(t.clientOrganizationId),
  }),
);

export type Engagement = typeof engagements.$inferSelect;

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

export const prepayments = pgTable(
  "prepayments",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    transferReference: text("transfer_reference"),
    actorAccountId: text("actor_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("prepayments_engagement_id").on(t.engagementId),
  }),
);

export type Prepayment = typeof prepayments.$inferSelect;

export type AllocationLine = { projectId: string; tokenId: string; amount: string };

export const changeOrders = pgTable(
  "change_orders",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    proposedBy: text("proposed_by", { enum: ["agency", "client"] }).notNull(),
    proposedByActor: text("proposed_by_actor").notNull(),
    status: text("status", {
      enum: ["proposed", "approved", "rejected", "withdrawn", "failed"],
    }).notNull(),
    effective: text("effective", { enum: ["next_period", "now"] }).notNull(),
    note: text("note"),
    moves: jsonb("moves").$type<AllocationLine[]>().notNull().default([]),
    plan: jsonb("plan").$type<AllocationLine[] | null>(),
    effectiveFrom: date("effective_from", { mode: "string" }),
    decidedByActor: text("decided_by_actor"),
    decidedAt: timestamp("decided_at", { withTimezone: false }),
    appliedAt: timestamp("applied_at", { withTimezone: false }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("change_orders_engagement_id").on(t.engagementId, t.createdAt),
  }),
);

export type ChangeOrder = typeof changeOrders.$inferSelect;

export const allocationPlans = pgTable(
  "allocation_plans",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id").references(() => changeOrders.id, {
      onDelete: "set null",
    }),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    lines: jsonb("lines").$type<AllocationLine[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("allocation_plans_engagement_id").on(t.engagementId, t.effectiveFrom),
  }),
);

export type AllocationPlan = typeof allocationPlans.$inferSelect;

export const allocationPeriods = pgTable(
  "allocation_periods",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    planId: text("plan_id")
      .notNull()
      .references(() => allocationPlans.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.engagementId, t.periodStart] }),
  }),
);

export const allocationLineApplications = pgTable(
  "allocation_line_applications",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    planId: text("plan_id")
      .notNull()
      .references(() => allocationPlans.id, { onDelete: "cascade" }),
    lineIndex: integer("line_index").notNull(),
    budgetId: text("budget_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.engagementId, t.periodStart, t.planId, t.lineIndex] }),
  }),
);

export const engagementIdeas = pgTable(
  "engagement_ideas",
  {
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.engagementId, t.projectId] }),
    projectIdx: index("engagement_ideas_project_id").on(t.projectId),
  }),
);

export const agentLinks = pgTable(
  "agent_links",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    ordering: integer("ordering").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    engagementIdx: index("agent_links_engagement_id").on(t.engagementId, t.ordering),
  }),
);
