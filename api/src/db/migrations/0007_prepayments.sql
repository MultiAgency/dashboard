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
