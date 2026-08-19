-- Epic 003: builders plugin, clients, client-scoped budgets/billings

-- Application converted status
ALTER TABLE "applications"
DROP CONSTRAINT IF EXISTS "applications_status_check";
--> statement-breakpoint
UPDATE "applications"
SET
    "status" = 'accepted'
WHERE
    "status" NOT IN (
        'new',
        'reviewing',
        'accepted',
        'declined'
    );
--> statement-breakpoint
ALTER TABLE "applications"
ADD CONSTRAINT "applications_status_check" CHECK (
    "status" IN (
        'new',
        'reviewing',
        'accepted',
        'declined',
        'converted'
    )
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
    "id" text PRIMARY KEY NOT NULL,
    "org_id" text NOT NULL,
    "agency_dao_account_id" text,
    "name" text NOT NULL,
    "near_account_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_org_id" ON "clients" ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_agency_near_unique" ON "clients" (
    "agency_dao_account_id",
    "near_account_id"
)
WHERE
    "near_account_id" IS NOT NULL
    AND "agency_dao_account_id" IS NOT NULL;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_projects" (
    "client_id" text NOT NULL REFERENCES "clients" ("id") ON DELETE CASCADE,
    "project_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("client_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_projects_project_id" ON "client_projects" ("project_id");

--> statement-breakpoint
ALTER TABLE "project_contributors"
ADD COLUMN IF NOT EXISTS "near_account" text;
--> statement-breakpoint
DELETE FROM "project_contributors"
WHERE
    "near_account" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_contributors"
DROP CONSTRAINT IF EXISTS "project_contributors_pkey";
--> statement-breakpoint
ALTER TABLE "project_contributors"
DROP COLUMN IF EXISTS "contributor_id";
--> statement-breakpoint
ALTER TABLE "project_contributors"
ALTER COLUMN "near_account"
SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_contributors"
ADD PRIMARY KEY ("project_id", "near_account");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_contributors_near_account" ON "project_contributors" ("near_account");

--> statement-breakpoint
ALTER TABLE "project_contributors"
ADD COLUMN IF NOT EXISTS "onboarding_status" text NOT NULL DEFAULT 'pending';

--> statement-breakpoint
ALTER TABLE "billings"
ADD COLUMN IF NOT EXISTS "near_account" text;
--> statement-breakpoint
ALTER TABLE "billings"
ADD COLUMN IF NOT EXISTS "client_id" text REFERENCES "clients" ("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "billings"
DROP COLUMN IF EXISTS "contributor_id";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billings_near_account" ON "billings" ("near_account");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billings_client_id" ON "billings" ("client_id");

--> statement-breakpoint
ALTER TABLE "budgets"
ADD COLUMN IF NOT EXISTS "client_id" text REFERENCES "clients" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_client_id" ON "budgets" ("client_id");
