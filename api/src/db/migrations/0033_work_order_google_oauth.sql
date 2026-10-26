ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_oauth_token" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_oauth_email" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_oauth_error" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_oauth_connected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_oauth_connected_by" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_field_map" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "custom_fields" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "document_warning" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "signed_drive_file_id" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "signed_drive_url" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "signed_drive_error" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_oauth_states" (
    "state_hash" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "user_id" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
