CREATE TABLE IF NOT EXISTS "organization_builders" (
    "organization_id" text NOT NULL,
    "near_account" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("organization_id", "near_account")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_builders_near_account" ON "organization_builders" ("near_account");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_public_settings" (
    "project_id" text PRIMARY KEY NOT NULL,
    "show_team" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
