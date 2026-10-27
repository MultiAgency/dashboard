ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "default_representative_name" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "default_representative_email" text;
