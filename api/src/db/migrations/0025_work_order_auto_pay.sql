ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_pay_blocked_reason" text;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_pay_blocked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_pay_tried_at" timestamp;
