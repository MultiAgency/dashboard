ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "payout_token_id" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "payout_token_id" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "payout_amount" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "price_usd" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "priced_at" timestamp;
