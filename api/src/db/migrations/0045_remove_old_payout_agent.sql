DROP TABLE IF EXISTS "payout_intents";
--> statement-breakpoint
DROP TABLE IF EXISTS "payout_agents";
--> statement-breakpoint
ALTER TABLE "platform_agents" DROP COLUMN IF EXISTS "payout_route";
