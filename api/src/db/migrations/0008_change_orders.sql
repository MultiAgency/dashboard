CREATE TABLE IF NOT EXISTS "change_orders" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "proposed_by" text NOT NULL,
    "proposed_by_actor" text NOT NULL,
    "status" text NOT NULL,
    "effective" text NOT NULL,
    "note" text,
    "moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "plan" jsonb,
    "effective_from" date,
    "decided_by_actor" text,
    "decided_at" timestamp,
    "applied_at" timestamp,
    "failure_reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_engagement_id" ON "change_orders" ("engagement_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_plans" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "change_order_id" text REFERENCES "change_orders" ("id") ON DELETE SET NULL,
    "effective_from" date NOT NULL,
    "lines" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allocation_plans_engagement_id" ON "allocation_plans" ("engagement_id", "effective_from");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_periods" (
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "period_start" date NOT NULL,
    "plan_id" text NOT NULL REFERENCES "allocation_plans" ("id") ON DELETE CASCADE,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("engagement_id", "period_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "allocation_line_applications" (
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "period_start" date NOT NULL,
    "plan_id" text NOT NULL REFERENCES "allocation_plans" ("id") ON DELETE CASCADE,
    "line_index" integer NOT NULL,
    "budget_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("engagement_id", "period_start", "plan_id", "line_index")
);
