CREATE TABLE IF NOT EXISTS "engagements" (
    "id" text PRIMARY KEY NOT NULL,
    "agency_organization_id" text NOT NULL,
    "client_organization_id" text NOT NULL,
    "kind" text DEFAULT 'client' NOT NULL,
    "status" text NOT NULL,
    "proposed_by" text NOT NULL,
    "invitation_id" text,
    "invitation_accepted_at" timestamp,
    "legacy_client_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "decided_at" timestamp,
    "ended_at" timestamp,
    CONSTRAINT "engagements_not_self" CHECK ("agency_organization_id" <> "client_organization_id"),
    CONSTRAINT "engagements_kind" CHECK ("kind" IN ('client', 'subcontract')),
    CONSTRAINT "engagements_status" CHECK ("status" IN ('proposed', 'active', 'declined', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagements_active_pair" ON "engagements" ("agency_organization_id", "client_organization_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagements_proposed_pair" ON "engagements" ("agency_organization_id", "client_organization_id") WHERE "status" = 'proposed';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagements_legacy_client" ON "engagements" ("legacy_client_id") WHERE "legacy_client_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_agency" ON "engagements" ("agency_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_client" ON "engagements" ("client_organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagement_projects" (
    "engagement_id" text NOT NULL REFERENCES "engagements"("id") ON DELETE CASCADE,
    "project_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "engagement_projects_pk" PRIMARY KEY ("engagement_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_projects_project_id" ON "engagement_projects" ("project_id");
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "engagement_id" text REFERENCES "engagements"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_engagement_id" ON "budgets" ("engagement_id");
--> statement-breakpoint
ALTER TABLE "project_contributors" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" text PRIMARY KEY NOT NULL,
    "recipient_user_id" text NOT NULL,
    "organization_id" text NOT NULL,
    "kind" text NOT NULL,
    "payload" text NOT NULL,
    "link" text,
    "read_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient" ON "notifications" ("recipient_user_id", "created_at", "id");
