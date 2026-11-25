CREATE TABLE IF NOT EXISTS "platform_agents" (
    "organization_id" text PRIMARY KEY NOT NULL,
    "owner_account_id" text NOT NULL,
    "area" text NOT NULL,
    "host" text NOT NULL,
    "deployment" text NOT NULL,
    "agent" text,
    "agent_id" text,
    "setup_public_key" text,
    "pending_kind" text,
    "pending_message" text,
    "pending_nonce" text,
    "pending_expires_at" timestamp,
    "pending_submission" text,
    "create_correlation_id" text,
    "create_confirm_url" text,
    "create_intent" text,
    "create_expires_at" timestamp,
    "create_status" text,
    "updated_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_consents" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "agent" text NOT NULL,
    "agent_id" text NOT NULL,
    "kind" text NOT NULL,
    "scopes" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "public_key" text NOT NULL,
    "message" text NOT NULL,
    "revoked_at" timestamp,
    "revoked_reason" text,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_consents_organization" ON "platform_consents" ("organization_id");
