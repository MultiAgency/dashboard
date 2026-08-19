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
    agencyDaoAccountId: text("agency_dao_account_id"),
    name: text("name").notNull(),
    nearAccountId: text("near_account_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    orgIdx: index("clients_org_id").on(t.orgId),
    agencyNearIdx: uniqueIndex("clients_agency_near_unique")
      .on(t.agencyDaoAccountId, t.nearAccountId)
      .where(sql`${t.nearAccountId} IS NOT NULL AND ${t.agencyDaoAccountId} IS NOT NULL`),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

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
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("budgets_cursor").on(t.createdAt, t.id),
    projectIdx: index("budgets_project_id").on(t.projectId),
    clientIdx: index("budgets_client_id").on(t.clientId),
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
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    proposalId: text("proposal_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("billings_cursor").on(t.createdAt, t.id),
    proposalUnique: uniqueIndex("billings_proposal_unique").on(t.proposalId),
    projectIdx: index("billings_project_id").on(t.projectId),
    clientIdx: index("billings_client_id").on(t.clientId),
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
