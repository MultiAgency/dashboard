CREATE TABLE IF NOT EXISTS "organization_join_requests" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "user_id" text NOT NULL,
    "display_name" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_join_requests_applicant" ON "organization_join_requests" ("organization_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_join_requests_organization_status" ON "organization_join_requests" ("organization_id", "status");
