import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const builders = pgTable(
  "builders",
  {
    id: text("id").primaryKey(),
    nearAccount: text("near_account").unique(),
    userId: text("user_id"),
    name: text("name"),
    bio: text("bio"),
    skills: text("skills"),
    location: text("location"),
    links: text("links"),
    githubLogin: text("github_login").unique(),
    kind: text("kind").notNull().default("human"),
    operatorId: text("operator_id").references((): AnyPgColumn => builders.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("builders_near_account_idx").on(table.nearAccount),
    index("builders_user_id_idx").on(table.userId),
    check("builders_kind_check", sql`${table.kind} in ('human', 'agent')`),
    check(
      "builders_operator_check",
      sql`(${table.kind} = 'agent') = (${table.operatorId} is not null)`,
    ),
    check("builders_github_login_check", sql`${table.githubLogin} = lower(${table.githubLogin})`),
  ],
);

export const builderAccounts = pgTable(
  "builder_accounts",
  {
    builderId: text("builder_id")
      .notNull()
      .references(() => builders.id),
    network: text("network").notNull(),
    account: text("account").notNull(),
    proof: text("proof").notNull(),
    verifiedAt: timestamp("verified_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.builderId, table.network] }),
    uniqueIndex("builder_accounts_network_account_idx").on(table.network, table.account),
    check("builder_accounts_network_check", sql`${table.network} in ('testnet', 'mainnet')`),
  ],
);

export const builderAdmissions = pgTable(
  "builder_admissions",
  {
    builderId: text("builder_id")
      .notNull()
      .references(() => builders.id),
    network: text("network").notNull(),
    status: text("status").notNull(),
    proofUrl: text("proof_url"),
    admittedAt: timestamp("admitted_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.builderId, table.network] }),
    check("builder_admissions_network_check", sql`${table.network} in ('testnet', 'mainnet')`),
    check(
      "builder_admissions_status_check",
      sql`${table.status} in ('admitted', 'suspended', 'removed')`,
    ),
  ],
);

export const builderAgreements = pgTable("builder_agreements", {
  builderId: text("builder_id")
    .primaryKey()
    .references(() => builders.id),
  version: text("version").notNull(),
  attestedAt: timestamp("attested_at").notNull(),
  proof: text("proof").notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});
