import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const applications = sqliteTable(
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
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    cursor: index("applications_cursor").on(t.createdAt, t.id),
  }),
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export const projects = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    ownerSlug: uniqueIndex("projects_owner_slug").on(t.ownerId, t.slug),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const contributors = sqliteTable("contributors", {
  id: text("id").primaryKey(),
  nearAccountId: text("near_account_id"),
  name: text("name").notNull(),
  email: text("email"),
  onboardingStatus: text("onboarding_status", {
    enum: ["pending", "complete", "expired"],
  })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;

export const projectContributors = sqliteTable(
  "project_contributors",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contributorId: text("contributor_id")
      .notNull()
      .references(() => contributors.id, { onDelete: "cascade" }),
    role: text("role"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.contributorId] }),
  }),
);

export const allocations = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    cursor: index("allocations_cursor").on(t.createdAt, t.id),
  }),
);

export type Allocation = typeof allocations.$inferSelect;
export type NewAllocation = typeof allocations.$inferInsert;

export const billings = sqliteTable(
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
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    cursor: index("billings_cursor").on(t.createdAt, t.id),
    proposalUnique: uniqueIndex("billings_proposal_unique").on(t.proposalId),
  }),
);

export type Billing = typeof billings.$inferSelect;
export type NewBilling = typeof billings.$inferInsert;

export const agencySettings = sqliteTable("agency_settings", {
  id: text("id").primaryKey(),
  daoAccountId: text("dao_account_id").notNull(),
  nearnAccountId: text("nearn_account_id"),
  name: text("name").notNull().default("MultiAgency"),
  headline: text("headline").default("Always building. Always open."),
  tagline: text("tagline").default("Join our agency. Hire us. Launch your own."),
  contactEmail: text("contact_email"),
  websiteUrl: text("website_url"),
  docsUrl: text("docs_url"),
  description: text("description"),
  metadata: text("metadata"),
  adminRoleName: text("admin_role_name").default("Admin"),
  approverRoleName: text("approver_role_name").default("Approver"),
  requestorRoleName: text("requestor_role_name").default("Requestor"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type AgencySettings = typeof agencySettings.$inferSelect;
