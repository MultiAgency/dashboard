CREATE TABLE IF NOT EXISTS "change_orders" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "proposed_by_organization_id" text NOT NULL,
    "proposed_by_user_id" text NOT NULL,
    "status" text NOT NULL,
    "effective" text NOT NULL,
    "effective_period" text,
    "note" text,
    "decided_by_user_id" text,
    "decided_at" timestamp,
    "applied_at" timestamp,
    "failure_reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "change_orders_status" CHECK ("status" IN ('proposed', 'approved', 'applied', 'rejected', 'withdrawn', 'failed')),
    CONSTRAINT "change_orders_effective" CHECK ("effective" IN ('next_period', 'now')),
    CONSTRAINT "change_orders_effective_period" CHECK ("effective_period" IS NULL OR "effective_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_engagement" ON "change_orders" ("engagement_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_pending" ON "change_orders" ("engagement_id", "status") WHERE "status" IN ('proposed', 'approved');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_order_items" (
    "id" text PRIMARY KEY NOT NULL,
    "change_order_id" text NOT NULL REFERENCES "change_orders"("id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "project_id" text,
    "token_id" text NOT NULL,
    "kind" text NOT NULL,
    "amount" text NOT NULL,
    CONSTRAINT "change_order_items_kind" CHECK ("kind" IN ('plan_change', 'one_off_move')),
    CONSTRAINT "change_order_items_amount" CHECK ("amount" ~ '^-?[1-9][0-9]*$'),
    CONSTRAINT "change_order_items_plan_project" CHECK ("kind" <> 'plan_change' OR "project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_items_change_order" ON "change_order_items" ("change_order_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_plan_lines" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "project_id" text NOT NULL,
    "token_id" text NOT NULL,
    "amount" text NOT NULL,
    "position" integer NOT NULL,
    "effective_from" text NOT NULL,
    "change_order_id" text NOT NULL REFERENCES "change_orders"("id"),
    "superseded_by" text REFERENCES "change_orders"("id"),
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "allocation_plan_lines_amount" CHECK ("amount" ~ '^[1-9][0-9]*$'),
    CONSTRAINT "allocation_plan_lines_effective_from" CHECK ("effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allocation_plan_lines_engagement" ON "allocation_plan_lines" ("engagement_id", "position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "allocation_plan_lines_current" ON "allocation_plan_lines" ("engagement_id", "project_id", "token_id") WHERE "superseded_by" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_plan_applications" (
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "period" text NOT NULL,
    "prepayment_id" text,
    "shortfall" text DEFAULT '[]' NOT NULL,
    "applied_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "allocation_plan_applications_pk" PRIMARY KEY ("engagement_id", "period"),
    CONSTRAINT "allocation_plan_applications_period" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
