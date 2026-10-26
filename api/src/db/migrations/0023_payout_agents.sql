CREATE TABLE IF NOT EXISTS "payout_agents" (
    "organization_id" text PRIMARY KEY NOT NULL,
    "owner_account_id" text NOT NULL,
    "agent_id" text,
    "grant_token_enc" text,
    "grant_expires_at" timestamp,
    "monthly_budget_usd" text NOT NULL,
    "max_payout_near" text NOT NULL,
    "updated_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_intents" (
    "correlation_id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "action" text NOT NULL,
    "intent_type" text NOT NULL,
    "intent" text NOT NULL,
    "agent_id" text,
    "grant_token_enc" text,
    "grant_expires_at" timestamp,
    "status" text NOT NULL,
    "failure_code" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_payouts" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "request_id" text NOT NULL,
    "attempt" integer NOT NULL,
    "status" text NOT NULL,
    "idempotency_key" text NOT NULL,
    "request_body" text NOT NULL,
    "correlation_id" text,
    "recipient" text NOT NULL,
    "amount" text NOT NULL,
    "asset_id" text NOT NULL,
    "tx_hash" text,
    "tx_url" text,
    "reason" text,
    "proven_unsent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_payouts_attempt" ON "agent_payouts" ("request_id", "attempt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_payouts_status" ON "agent_payouts" ("status");
