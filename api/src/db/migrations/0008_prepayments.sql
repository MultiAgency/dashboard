CREATE TABLE IF NOT EXISTS "prepayments" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "dao_account_id" text NOT NULL,
    "token_id" text NOT NULL,
    "amount" text NOT NULL,
    "period" text NOT NULL,
    "transfer_reference" text,
    "actor_account_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "prepayments_period" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "prepayments_amount" CHECK ("amount" ~ '^[1-9][0-9]*$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepayments_engagement" ON "prepayments" ("engagement_id", "period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prepayments_dao" ON "prepayments" ("dao_account_id");
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "funding_dao_account_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_funding_dao" ON "budgets" ("funding_dao_account_id");
--> statement-breakpoint
UPDATE "budgets" SET "funding_dao_account_id" = "organization_daos"."dao_account_id"
FROM "engagements", "organization_daos"
WHERE "budgets"."funding_dao_account_id" IS NULL
  AND "budgets"."engagement_id" = "engagements"."id"
  AND "organization_daos"."organization_id" = "engagements"."agency_organization_id";
--> statement-breakpoint
UPDATE "budgets" SET "funding_dao_account_id" = "clients"."agency_dao_account_id"
FROM "clients"
WHERE "budgets"."funding_dao_account_id" IS NULL
  AND "budgets"."client_id" = "clients"."id";
