ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "trust" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_approve_at" timestamp;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_decision" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_stopped_by" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_stopped_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compensation_requests_auto_approve_at" ON "compensation_requests" ("auto_approve_at");
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "trust_mode" text DEFAULT 'suggest' NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "trust_veto_hours" integer DEFAULT 24 NOT NULL;
