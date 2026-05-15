CREATE TABLE "agency_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"dao_account_id" text NOT NULL,
	"nearn_account_id" text,
	"name" text DEFAULT 'MultiAgency' NOT NULL,
	"headline" text DEFAULT 'Open Books · Open Source · Open Doors',
	"tagline" text DEFAULT 'The future of work is near…',
	"contact_email" text DEFAULT 'multiagentic@gmail.com',
	"website_url" text,
	"docs_url" text,
	"description" text,
	"metadata" text,
	"admin_role_name" text DEFAULT 'Admin',
	"approver_role_name" text DEFAULT 'Approver',
	"requestor_role_name" text DEFAULT 'Requestor',
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token_id" text NOT NULL,
	"amount" text NOT NULL,
	"note" text,
	"actor_account_id" text NOT NULL,
	"related_allocation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
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
CREATE TABLE "billings" (
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
CREATE TABLE "contributors" (
	"id" text PRIMARY KEY NOT NULL,
	"near_account_id" text,
	"name" text NOT NULL,
	"email" text,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_contributors" (
	"project_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_contributors_project_id_contributor_id_pk" PRIMARY KEY("project_id","contributor_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"nearn_listing_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billings" ADD CONSTRAINT "billings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billings" ADD CONSTRAINT "billings_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contributors" ADD CONSTRAINT "project_contributors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contributors" ADD CONSTRAINT "project_contributors_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_cursor" ON "allocations" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "applications_cursor" ON "applications" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "billings_cursor" ON "billings" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billings_proposal_unique" ON "billings" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_slug" ON "projects" USING btree ("owner_id","slug");