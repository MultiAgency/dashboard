ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "esign_envelope_id" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "esign_builder_url" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "esign_representative_url" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "esign_error" text;
