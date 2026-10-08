ALTER TABLE "report_snapshots" ADD COLUMN IF NOT EXISTS "shared_at" timestamp;
--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD COLUMN IF NOT EXISTS "shared_by_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_snapshots_engagement_shared" ON "report_snapshots" ("engagement_id", "shared_at");
