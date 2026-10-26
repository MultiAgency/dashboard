CREATE TABLE IF NOT EXISTS "client_agreements" (
    "id" text PRIMARY KEY NOT NULL,
    "engagement_id" text NOT NULL REFERENCES "engagements"("id"),
    "kind" text NOT NULL,
    "title" text NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "token_id" text NOT NULL,
    "agreed_amount" text NOT NULL,
    "note" text,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_agreements_engagement" ON "client_agreements" ("engagement_id", "start_date");
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "agreement_id" text REFERENCES "client_agreements"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_agreement_id" ON "budgets" ("agreement_id");
--> statement-breakpoint
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "agreement_id" text;
