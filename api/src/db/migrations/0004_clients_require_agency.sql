ALTER TABLE "clients"
ALTER COLUMN "agency_dao_account_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "clients_agency_near_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_agency_near_unique" ON "clients" (
    "agency_dao_account_id",
    "near_account_id"
)
WHERE
    "near_account_id" IS NOT NULL;
