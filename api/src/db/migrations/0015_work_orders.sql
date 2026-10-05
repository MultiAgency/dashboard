CREATE TABLE IF NOT EXISTS "work_orders" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "near_account" text NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "starts_on" date NOT NULL,
    "ends_on" date NOT NULL,
    "document_url" text,
    "closed_at" timestamp,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "work_orders_status" CHECK ("status" IN ('draft', 'signed', 'completed', 'terminated')),
    CONSTRAINT "work_orders_period" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_organization" ON "work_orders" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_orders_near_account" ON "work_orders" ("near_account");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_lines" (
    "work_order_id" text NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
    "project_id" text NOT NULL,
    "token_id" text NOT NULL,
    "amount" text NOT NULL,
    PRIMARY KEY ("work_order_id", "project_id", "token_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_lines_project" ON "work_order_lines" ("project_id");
