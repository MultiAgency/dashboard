CREATE TABLE IF NOT EXISTS "organization_approvals" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL CHECK ("status" IN ('pending', 'approved', 'rejected')),
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_approvals_adoption" (
	"id" integer PRIMARY KEY NOT NULL CHECK ("id" = 1),
	"cutoff" timestamp with time zone DEFAULT now() NOT NULL,
	"adopted_at" timestamp with time zone
);
--> statement-breakpoint
INSERT INTO "organization_approvals_adoption" ("id") VALUES (1) ON CONFLICT DO NOTHING;
