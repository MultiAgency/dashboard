ALTER TABLE "compensation_requests" ADD COLUMN IF NOT EXISTS "auto_pay_hold_notified" text;
--> statement-breakpoint
UPDATE "compensation_requests" SET "auto_pay_hold_notified" = "auto_pay_blocked_code" WHERE "auto_pay_blocked_code" IS NOT NULL;
