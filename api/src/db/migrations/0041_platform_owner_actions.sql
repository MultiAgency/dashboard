ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "payout_asset" text;
--> statement-breakpoint
ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "max_per_payout" text;
--> statement-breakpoint
ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "monthly_budget_usd" text;
--> statement-breakpoint
ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "grant_reminded_for" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_owner_actions" (
    "correlation_id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "agent" text NOT NULL,
    "kind" text NOT NULL,
    "summary" text NOT NULL,
    "confirm_url" text,
    "intent" text,
    "expires_at" timestamp NOT NULL,
    "status" text NOT NULL,
    "requested_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_owner_actions_organization" ON "platform_owner_actions" ("organization_id");
