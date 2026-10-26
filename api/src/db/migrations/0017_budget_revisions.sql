CREATE TABLE IF NOT EXISTS "budget_revisions" (
    "id" text PRIMARY KEY NOT NULL,
    "budget_id" text NOT NULL,
    "action" text NOT NULL,
    "project_id" text NOT NULL,
    "token_id" text NOT NULL,
    "amount" text NOT NULL,
    "note" text,
    "effective_on" date,
    "related_budget_id" text,
    "engagement_id" text,
    "funding_dao_account_id" text,
    "actor_account_id" text NOT NULL,
    "budget_created_at" timestamp NOT NULL,
    "changed_by" text NOT NULL,
    "changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_revisions_budget" ON "budget_revisions" ("budget_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_revisions_project" ON "budget_revisions" ("project_id", "changed_at");
