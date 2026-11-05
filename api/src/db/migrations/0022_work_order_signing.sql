ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "project_title" text;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "project_slug" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_documents" (
    "id" text PRIMARY KEY NOT NULL,
    "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "file_name" text NOT NULL,
    "pdf" text NOT NULL,
    "sha256" text NOT NULL,
    "terms_hash" text NOT NULL,
    "drive_file_id" text,
    "drive_url" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_documents_work_order" ON "work_order_documents" ("work_order_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_signatures" (
    "id" text PRIMARY KEY NOT NULL,
    "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
    "document_sha256" text NOT NULL,
    "role" text NOT NULL,
    "name" text NOT NULL,
    "email" text,
    "user_id" text,
    "near_account" text,
    "ip" text,
    "user_agent" text,
    "signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_signatures_once" ON "work_order_signatures" ("work_order_id", "document_sha256", "role");
