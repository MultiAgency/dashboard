ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "document_id" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "document_fields" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_template_id" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_documents_folder_id" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_signed_folder_id" text;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_checked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "work_order_integrations" ADD COLUMN IF NOT EXISTS "google_last_error" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_drive_files" (
    "file_id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "name" text NOT NULL,
    "url" text,
    "sha256" text,
    "work_order_id" text,
    "outcome" text NOT NULL,
    "note" text,
    "processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_drive_files_organization" ON "work_order_drive_files" ("organization_id", "processed_at");
