DELETE FROM "work_order_outbox" WHERE "channel" = 'n8n';
--> statement-breakpoint
ALTER TABLE "work_order_integrations" DROP COLUMN IF EXISTS "n8n_webhook_url";
--> statement-breakpoint
ALTER TABLE "work_order_integrations" DROP COLUMN IF EXISTS "webhook_secret";
--> statement-breakpoint
ALTER TABLE "work_order_integrations" DROP COLUMN IF EXISTS "inbound_token_hash";
--> statement-breakpoint
ALTER TABLE "work_order_outbox" DROP COLUMN IF EXISTS "channel";
