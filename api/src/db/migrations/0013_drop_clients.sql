DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "clients" c
        WHERE NOT EXISTS (SELECT 1 FROM "engagements" e WHERE e."legacy_client_id" = c."id")
    ) OR EXISTS (
        SELECT 1 FROM "client_projects" cp
        WHERE NOT EXISTS (
            SELECT 1 FROM "engagements" e
            JOIN "engagement_projects" ep ON ep."engagement_id" = e."id"
            WHERE e."legacy_client_id" = cp."client_id" AND ep."project_id" = cp."project_id"
        )
    ) OR EXISTS (
        SELECT 1 FROM "budgets" b
        WHERE b."client_id" IS NOT NULL AND b."engagement_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Legacy clients are not migrated to Engagements yet. Run db:migrate:engagements before deploying this migration.';
    END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "budgets_client_id";
--> statement-breakpoint
ALTER TABLE "budgets" DROP COLUMN IF EXISTS "client_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "client_projects";
--> statement-breakpoint
DROP TABLE IF EXISTS "clients";
