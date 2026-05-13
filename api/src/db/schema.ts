import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["replicate", "contributor"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    nearAccountId: text("near_account_id"),
    message: text("message"),
    metadata: text("metadata"),
    status: text("status", { enum: ["new", "reviewing", "accepted", "declined"] })
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

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    organizationId: text("organization_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    nearnListingId: text("nearn_listing_id"),
    status: text("status", { enum: ["active", "paused", "archived"] })
      .notNull()
      .default("active"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    ownerSlug: uniqueIndex("projects_owner_slug").on(t.ownerId, t.slug),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const contributors = pgTable("contributors", {
  id: text("id").primaryKey(),
  nearAccountId: text("near_account_id"),
  name: text("name").notNull(),
  email: text("email"),
  onboardingStatus: text("onboarding_status", {
    enum: ["pending", "complete", "expired"],
  })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;

export const projectContributors = pgTable(
  "project_contributors",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contributorId: text("contributor_id")
      .notNull()
      .references(() => contributors.id, { onDelete: "cascade" }),
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.contributorId] }),
  }),
);

export const allocations = pgTable(
  "allocations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    note: text("note"),
    actorAccountId: text("actor_account_id").notNull(),
    relatedAllocationId: text("related_allocation_id"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("allocations_cursor").on(t.createdAt, t.id),
  }),
);

export type Allocation = typeof allocations.$inferSelect;
export type NewAllocation = typeof allocations.$inferInsert;

export const billings = pgTable(
  "billings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contributorId: text("contributor_id").references(() => contributors.id, {
      onDelete: "set null",
    }),
    tokenId: text("token_id").notNull(),
    amount: text("amount").notNull(),
    proposalId: text("proposal_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().default(sql`now()`),
  },
  (t) => ({
    cursor: index("billings_cursor").on(t.createdAt, t.id),
    proposalUnique: uniqueIndex("billings_proposal_unique").on(t.proposalId),
  }),
);

export type Billing = typeof billings.$inferSelect;
export type NewBilling = typeof billings.$inferInsert;

export const agencySettings = pgTable("agency_settings", {
  id: text("id").primaryKey(),
  daoAccountId: text("dao_account_id").notNull(),
  nearnAccountId: text("nearn_account_id"),
  name: text("name").notNull().default("MultiAgency"),
  headline: text("headline").default("Open Books · Open Source · Open Doors"),
  tagline: text("tagline").default("The future of work is near…"),
  contactEmail: text("contact_email").default("multiagentic@gmail.com"),
  websiteUrl: text("website_url"),
  docsUrl: text("docs_url"),
  description: text("description"),
  metadata: text("metadata"),
  adminRoleName: text("admin_role_name").default("Admin"),
  approverRoleName: text("approver_role_name").default("Approver"),
  requestorRoleName: text("requestor_role_name").default("Requestor"),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().default(sql`now()`),
});

export type AgencySettings = typeof agencySettings.$inferSelect;
