CREATE TABLE IF NOT EXISTS "work_orders" (
    "id" text PRIMARY KEY NOT NULL,
    "code" text NOT NULL,
    "organization_id" text NOT NULL,
    "project_id" text NOT NULL,
    "builder_near_account" text NOT NULL,
    "github_login" text,
    "title" text NOT NULL,
    "scope" text,
    "repos" text DEFAULT '[]' NOT NULL,
    "period_start" date NOT NULL,
    "period_end" date NOT NULL,
    "grace_days" integer DEFAULT 2 NOT NULL,
    "token_id" text NOT NULL,
    "budget_amount" text NOT NULL,
    "auto_renew" boolean DEFAULT false NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "offered_at" timestamp,
    "accepted_at" timestamp,
    "accepted_by_user_id" text,
    "accepted_terms_hash" text,
    "contractor_name" text,
    "contractor_email" text,
    "representative_name" text,
    "representative_email" text,
    "ip_model" text,
    "prepared_document_url" text,
    "signature_method" text,
    "signers" text,
    "signed_at" timestamp,
    "payee_confirmed_at" timestamp,
    "payee_confirmed_by" text,
    "document_sha256" text,
    "document_url" text,
    "activated_at" timestamp,
    "activated_by" text,
    "last_collected_at" timestamp,
    "ending_soon_at" timestamp,
    "auto_drafted_for" date,
    "renewed_from" text,
    "renewal_root" text,
    "renewal_seq" integer DEFAULT 1 NOT NULL,
    "renewal_status" text,
    "renewal_assessment" text,
    "renewal_decided_by" text,
    "renewal_decided_at" timestamp,
    "renewal_note" text,
    "renewed_to" text,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_organization_code" ON "work_orders" ("organization_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_organization_status" ON "work_orders" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_builder" ON "work_orders" ("builder_near_account");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_project" ON "work_orders" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_evidence" (
    "id" text PRIMARY KEY NOT NULL,
    "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "repo" text,
    "number" integer,
    "url" text NOT NULL,
    "title" text NOT NULL,
    "state" text NOT NULL,
    "occurred_at" timestamp,
    "assigned_at" timestamp,
    "assigned_by" text,
    "authorized" boolean DEFAULT false NOT NULL,
    "confirmed" boolean DEFAULT false NOT NULL,
    "flags" text DEFAULT '[]' NOT NULL,
    "links" text DEFAULT '[]' NOT NULL,
    "details" text DEFAULT '{}' NOT NULL,
    "collected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_evidence_unique" ON "work_order_evidence" ("work_order_id", "kind", "url");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compensation_requests" (
    "id" text PRIMARY KEY NOT NULL,
    "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
    "seq" integer NOT NULL,
    "covers_from" date NOT NULL,
    "covers_to" date NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "requested_amount" text NOT NULL,
    "approved_amount" text,
    "approved_by" text,
    "decided_at" timestamp,
    "note" text,
    "summary" text,
    "contributions_md" text NOT NULL,
    "assessment_md" text NOT NULL,
    "assessment_edited" boolean DEFAULT false NOT NULL,
    "manual_items" text DEFAULT '[]' NOT NULL,
    "evidence_ids" text,
    "report_md" text,
    "report_sha256" text,
    "billing_id" text REFERENCES "billings"("id") ON DELETE SET NULL,
    "proposal_id" text,
    "submitted_at" timestamp,
    "paid_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compensation_requests_sequence" ON "compensation_requests" ("work_order_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compensation_requests_status" ON "compensation_requests" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_job_lock" (
    "id" text PRIMARY KEY NOT NULL,
    "holder" text NOT NULL,
    "until" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_integrations" (
    "organization_id" text PRIMARY KEY NOT NULL,
    "n8n_webhook_url" text,
    "webhook_secret" text NOT NULL,
    "inbound_token_hash" text NOT NULL,
    "updated_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_outbox" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "work_order_id" text,
    "channel" text NOT NULL,
    "event_type" text NOT NULL,
    "payload" text NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp DEFAULT now() NOT NULL,
    "delivered_at" timestamp,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_outbox_due" ON "work_order_outbox" ("delivered_at", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_outbox_organization" ON "work_order_outbox" ("organization_id", "created_at");
