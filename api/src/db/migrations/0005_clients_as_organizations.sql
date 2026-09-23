CREATE TABLE IF NOT EXISTS "organization_daos" (
    "organization_id" text PRIMARY KEY NOT NULL,
    "dao_account_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_daos_dao_unique" ON "organization_daos" ("dao_account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagements" (
    "id" text PRIMARY KEY NOT NULL,
    "agency_organization_id" text NOT NULL,
    "agency_name" text DEFAULT '' NOT NULL,
    "client_organization_id" text NOT NULL,
    "client_name" text DEFAULT '' NOT NULL,
    "kind" text DEFAULT 'client' NOT NULL,
    "status" text NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "ended_at" timestamp,
    CONSTRAINT "engagements_distinct_parties" CHECK ("agency_organization_id" <> "client_organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagements_active_pair" ON "engagements" ("agency_organization_id", "client_organization_id", "kind") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_agency" ON "engagements" ("agency_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_client" ON "engagements" ("client_organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagement_projects" (
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "project_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("engagement_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_projects_project_id" ON "engagement_projects" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prepayments" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "token_id" text NOT NULL,
    "amount" text NOT NULL,
    "period_start" date NOT NULL,
    "period_end" date NOT NULL,
    "transfer_reference" text,
    "actor_account_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "prepayments_period" CHECK ("period_start" <= "period_end")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepayments_engagement_id" ON "prepayments" ("engagement_id");
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "dao_account_id" text;
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "engagement_id" text REFERENCES "engagements" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_engagement_id" ON "budgets" ("engagement_id");
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "billings" ADD COLUMN IF NOT EXISTS "dao_account_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagement_ideas" (
  "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
  "project_id" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("engagement_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_ideas_project_id" ON "engagement_ideas" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_links" (
  "id" text PRIMARY KEY,
  "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "url" text NOT NULL,
  "ordering" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_links_engagement_id" ON "agent_links" ("engagement_id", "ordering");
--> statement-breakpoint
INSERT INTO "engagements" (
    "id", "agency_organization_id", "client_organization_id", "client_name",
    "kind", "status", "created_by", "created_at", "updated_at"
)
SELECT DISTINCT ON (agency, c."org_id")
    'eng_' || c."id", agency, c."org_id", c."name", 'client', 'active', 'migration', c."created_at", now()
FROM (
    SELECT c.*, COALESCE(od."organization_id", c."agency_dao_account_id") AS agency
    FROM "clients" c
    LEFT JOIN "organization_daos" od ON od."dao_account_id" = c."agency_dao_account_id"
) c
WHERE c."org_id" <> agency
ORDER BY agency, c."org_id", c."created_at"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "engagement_projects" ("engagement_id", "project_id", "created_at")
SELECT e."id", cp."project_id", cp."created_at"
FROM "client_projects" cp
JOIN "clients" c ON c."id" = cp."client_id"
LEFT JOIN "organization_daos" od ON od."dao_account_id" = c."agency_dao_account_id"
JOIN "engagements" e
    ON e."client_organization_id" = c."org_id"
    AND e."agency_organization_id" = COALESCE(od."organization_id", c."agency_dao_account_id")
    AND e."status" = 'active'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "budgets" b
SET "dao_account_id" = c."agency_dao_account_id",
    "engagement_id" = e."id"
FROM "clients" c
LEFT JOIN "organization_daos" od ON od."dao_account_id" = c."agency_dao_account_id"
LEFT JOIN "engagements" e
    ON e."client_organization_id" = c."org_id"
    AND e."agency_organization_id" = COALESCE(od."organization_id", c."agency_dao_account_id")
    AND e."status" = 'active'
WHERE b."client_id" = c."id";
--> statement-breakpoint
UPDATE "billings" b
SET "dao_account_id" = c."agency_dao_account_id"
FROM "clients" c
WHERE b."client_id" = c."id" AND b."dao_account_id" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "billings_client_id";
--> statement-breakpoint
ALTER TABLE "billings" DROP COLUMN IF EXISTS "client_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "billings_proposal_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billings_proposal_unique" ON "billings" ("dao_account_id", "proposal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billings_dao_account_id" ON "billings" ("dao_account_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "budgets_client_id";
--> statement-breakpoint
ALTER TABLE "budgets" DROP COLUMN IF EXISTS "client_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "client_projects";
--> statement-breakpoint
DROP TABLE IF EXISTS "clients";
