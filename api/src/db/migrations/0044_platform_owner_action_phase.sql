ALTER TABLE "platform_owner_actions" ADD COLUMN IF NOT EXISTS "phase" text;
--> statement-breakpoint
ALTER TABLE "platform_owner_actions" DROP COLUMN IF EXISTS "subject";
--> statement-breakpoint
ALTER TABLE "platform_owner_actions" DROP COLUMN IF EXISTS "verdict";
