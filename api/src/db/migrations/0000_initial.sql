-- Hand-edited for idempotency (IF NOT EXISTS / DROP IF EXISTS guards).
-- Drizzle-generated structure preserved; running `db:generate` would strip the guards — re-add them on regeneration.
-- The legacy `agency.settings` table from pre-SPEC-cut deployments used a network-PK shape;
-- v1 keys by orgAccountId (multi-tenant native), so DROP the legacy table first to avoid schema shadowing.
DROP TABLE IF EXISTS "agency"."settings";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "agency";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."applications" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"near_account_id" text,
	"message" text,
	"metadata" text,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."billings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"contributor_id" text,
	"token_id" text NOT NULL,
	"amount" text NOT NULL,
	"proposal_id" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token_id" text NOT NULL,
	"amount" text NOT NULL,
	"note" text,
	"actor_account_id" text NOT NULL,
	"related_budget_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."contributors" (
	"id" text PRIMARY KEY NOT NULL,
	"near_account_id" text,
	"name" text NOT NULL,
	"email" text,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."listings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"title" text,
	"description" text,
	"type" text,
	"status" text,
	"token" text,
	"reward_amount" text,
	"compensation_type" text,
	"min_reward_ask" text,
	"max_reward_ask" text,
	"total_payments_made" integer,
	"total_winners_selected" integer,
	"submission_limit" text,
	"rewards" text,
	"max_bonus_spots" integer,
	"usd_value" text,
	"skills" text,
	"region" text,
	"application_type" text,
	"multiple_submission_rule" text,
	"time_to_complete" text,
	"requirements" text,
	"sequential_id" integer,
	"nearn_published_at" timestamp,
	"deadline" timestamp,
	"is_published" boolean,
	"is_archived" boolean,
	"is_featured" boolean,
	"is_private" boolean,
	"is_winners_announced" boolean,
	"is_hackathon_prize" boolean,
	"hackathon_slug" text,
	"hackathon_name" text,
	"hackathon_start_date" timestamp,
	"hackathon_announce_date" timestamp,
	"sponsor_name" text,
	"sponsor_slug" text,
	"sponsor_logo" text,
	"sponsor_verified" boolean,
	"sponsor_entity_name" text,
	"sponsor_is_caution" boolean,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."project_contributors" (
	"project_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_contributors_project_id_contributor_id_pk" PRIMARY KEY("project_id","contributor_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."proposals" (
	"dao_account_id" text NOT NULL,
	"proposal_id" integer NOT NULL,
	"proposer" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"kind_type" text NOT NULL,
	"transfer_token_id" text,
	"transfer_receiver_id" text,
	"transfer_amount" text,
	"other_kind_name" text,
	"submission_time" text NOT NULL,
	"indexed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_dao_account_id_proposal_id_pk" PRIMARY KEY("dao_account_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency"."settings" (
	"org_account_id" text PRIMARY KEY NOT NULL,
	"nearn_account_id" text,
	"website_url" text,
	"docs_url" text,
	"description" text,
	"contact_email" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency"."billings" DROP CONSTRAINT IF EXISTS "billings_contributor_id_contributors_id_fk";--> statement-breakpoint
ALTER TABLE "agency"."billings" ADD CONSTRAINT "billings_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "agency"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency"."project_contributors" DROP CONSTRAINT IF EXISTS "project_contributors_contributor_id_contributors_id_fk";--> statement-breakpoint
ALTER TABLE "agency"."project_contributors" ADD CONSTRAINT "project_contributors_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "agency"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_cursor" ON "agency"."applications" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billings_cursor" ON "agency"."billings" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billings_proposal_unique" ON "agency"."billings" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billings_project_id" ON "agency"."billings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_cursor" ON "agency"."budgets" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_project_id" ON "agency"."budgets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contributors_near_account_id" ON "agency"."contributors" USING btree ("near_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_project_id" ON "agency"."listings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_project_source" ON "agency"."listings" USING btree ("project_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_source_external_id" ON "agency"."listings" USING btree ("source","external_id") WHERE "agency"."listings"."external_id" IS NOT NULL;
