ALTER TABLE "billings" ADD COLUMN IF NOT EXISTS "paying_dao_account_id" text;
--> statement-breakpoint
UPDATE "billings" SET "paying_dao_account_id" = "clients"."agency_dao_account_id"
FROM "clients"
WHERE "billings"."paying_dao_account_id" IS NULL
  AND "billings"."client_id" = "clients"."id";
--> statement-breakpoint
UPDATE "billings" SET "paying_dao_account_id" = "funded"."dao_account_id"
FROM (
  SELECT "project_id", min("funding_dao_account_id") AS "dao_account_id"
  FROM "budgets"
  WHERE "funding_dao_account_id" IS NOT NULL
  GROUP BY "project_id"
  HAVING count(DISTINCT "funding_dao_account_id") = 1
) AS "funded"
WHERE "billings"."paying_dao_account_id" IS NULL
  AND "billings"."project_id" = "funded"."project_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "billings_proposal_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billings_paying_dao_proposal_unique" ON "billings" ("paying_dao_account_id", "proposal_id");
--> statement-breakpoint
ALTER TABLE "project_contributors" ADD COLUMN IF NOT EXISTS "assigned_by_organization_id" text;
--> statement-breakpoint
UPDATE "project_contributors" SET "assigned_by_organization_id" = "organization_id"
WHERE "assigned_by_organization_id" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "billings_client_id";
--> statement-breakpoint
ALTER TABLE "billings" DROP COLUMN IF EXISTS "client_id";
