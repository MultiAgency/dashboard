ALTER TABLE "platform_agents" ADD COLUMN IF NOT EXISTS "payout_route" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_payouts" (
    "request_id" text PRIMARY KEY NOT NULL,
    "compensation_request_id" text NOT NULL,
    "attempt" integer NOT NULL,
    "organization_id" text NOT NULL,
    "agent" text NOT NULL,
    "asset" text NOT NULL,
    "chain" text NOT NULL,
    "recipient" text NOT NULL,
    "amount" text NOT NULL,
    "expected_revision" integer NOT NULL,
    "expected_digest" text NOT NULL,
    "state" text NOT NULL,
    "status" text,
    "code" text,
    "failure_code" text,
    "never_executed" boolean DEFAULT false NOT NULL,
    "correlation_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_payouts_attempt" ON "platform_payouts" ("compensation_request_id", "attempt");
