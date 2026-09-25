CREATE TABLE IF NOT EXISTS "organization_daos" (
    "organization_id" text PRIMARY KEY NOT NULL,
    "dao_account_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_daos_dao_unique" ON "organization_daos" ("dao_account_id");
