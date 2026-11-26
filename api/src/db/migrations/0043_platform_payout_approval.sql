ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "owner_approval" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_payouts" ADD COLUMN IF NOT EXISTS "allow_duplicate_held" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_owner_actions" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "platform_owner_actions" ADD COLUMN IF NOT EXISTS "verdict" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_deposits" (
    "request_id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "agent" text NOT NULL,
    "asset" text NOT NULL,
    "state" text NOT NULL,
    "address" text,
    "memo" text,
    "min_amount" text,
    "expires_at" timestamp,
    "code" text,
    "requested_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_deposits_organization" ON "platform_deposits" ("organization_id");
