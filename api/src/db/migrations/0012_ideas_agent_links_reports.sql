CREATE TABLE IF NOT EXISTS "ideas" (
    "project_id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "submitted_by_user_id" text NOT NULL,
    "status" text DEFAULT 'new' NOT NULL,
    "result_project_id" text,
    "decided_by_user_id" text,
    "decided_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "ideas_status" CHECK ("status" IN ('new', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ideas_engagement" ON "ideas" ("engagement_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_links" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "label" text NOT NULL,
    "url" text NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "agent_links_url" CHECK ("url" ~ '^https?://')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_links_engagement" ON "agent_links" ("engagement_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_snapshots" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "engagement_id" text REFERENCES "engagements"("id"),
    "generated_by_user_id" text NOT NULL,
    "start_date" text,
    "end_date" text,
    "note" text,
    "payload" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_snapshots_organization" ON "report_snapshots" ("organization_id", "created_at", "id");
