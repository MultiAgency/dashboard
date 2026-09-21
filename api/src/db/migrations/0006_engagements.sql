CREATE TABLE IF NOT EXISTS "engagements" (
    "id" text PRIMARY KEY NOT NULL,
    "agency_organization_id" text NOT NULL,
    "agency_name" text DEFAULT '' NOT NULL,
    "client_organization_id" text NOT NULL,
    "client_name" text DEFAULT '' NOT NULL,
    "kind" text DEFAULT 'client' NOT NULL,
    "status" text NOT NULL,
    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "ended_at" timestamp,
    CONSTRAINT "engagements_distinct_parties" CHECK ("agency_organization_id" <> "client_organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engagements_active_pair" ON "engagements" ("agency_organization_id", "client_organization_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_agency" ON "engagements" ("agency_organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagements_client" ON "engagements" ("client_organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagement_projects" (
    "engagement_id" text NOT NULL REFERENCES "engagements" ("id") ON DELETE CASCADE,
    "project_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("engagement_id", "project_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_projects_project_id" ON "engagement_projects" ("project_id");
--> statement-breakpoint
INSERT INTO "engagements" (
    "id", "agency_organization_id", "client_organization_id", "client_name",
    "kind", "status", "created_by", "created_at", "updated_at"
)
SELECT DISTINCT ON (agency, c."org_id")
    'eng_' || c."id", agency, c."org_id", c."name", 'client', 'active', 'migration', c."created_at", now()
FROM (
    SELECT c.*, COALESCE(od."organization_id", c."agency_dao_account_id") AS agency
    FROM "clients" c
    LEFT JOIN "organization_daos" od ON od."dao_account_id" = c."agency_dao_account_id"
) c
WHERE c."org_id" <> agency
ORDER BY agency, c."org_id", c."created_at"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "engagement_projects" ("engagement_id", "project_id", "created_at")
SELECT e."id", cp."project_id", cp."created_at"
FROM "client_projects" cp
JOIN "clients" c ON c."id" = cp."client_id"
LEFT JOIN "organization_daos" od ON od."dao_account_id" = c."agency_dao_account_id"
JOIN "engagements" e
    ON e."client_organization_id" = c."org_id"
    AND e."agency_organization_id" = COALESCE(od."organization_id", c."agency_dao_account_id")
    AND e."status" = 'active'
ON CONFLICT DO NOTHING;
