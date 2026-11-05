ALTER TABLE "payout_agents" ADD COLUMN IF NOT EXISTS "grant_reminded_for" timestamp;
--> statement-breakpoint
ALTER TABLE "payout_intents" ADD COLUMN IF NOT EXISTS "signer_account_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "payout_intents" ALTER COLUMN "signer_account_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "payout_intents" ADD COLUMN IF NOT EXISTS "signer_public_key" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "payout_intents" ALTER COLUMN "signer_public_key" DROP DEFAULT;
