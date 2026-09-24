DROP INDEX IF EXISTS "billings_client_id";
--> statement-breakpoint
ALTER TABLE "billings" DROP COLUMN IF EXISTS "client_id";
