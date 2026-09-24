DO $$
BEGIN
    CREATE TEMP TABLE "legacy_client_engagements" ON COMMIT DROP AS
    SELECT c."id" AS "client_id", e."id" AS "engagement_id"
    FROM "clients" c
    JOIN "engagements" e ON e."legacy_client_id" = c."id"
        OR (
            e."client_organization_id" = c."org_id"
            AND e."status" IN ('active', 'ended')
            AND e."agency_organization_id" IN (
                SELECT d."organization_id" FROM "organization_daos" d
                WHERE d."dao_account_id" = c."agency_dao_account_id"
            )
        );
    IF EXISTS (
        SELECT 1 FROM "clients" c
        WHERE NOT EXISTS (SELECT 1 FROM "legacy_client_engagements" l WHERE l."client_id" = c."id")
        AND NOT EXISTS (
            SELECT 1 FROM "organization_daos" d
            WHERE d."dao_account_id" = c."agency_dao_account_id" AND d."organization_id" = c."org_id"
        )
    ) OR EXISTS (
        SELECT 1 FROM "client_projects" cp
        WHERE NOT EXISTS (
            SELECT 1 FROM "legacy_client_engagements" l
            JOIN "engagement_projects" ep ON ep."engagement_id" = l."engagement_id"
            WHERE l."client_id" = cp."client_id" AND ep."project_id" = cp."project_id"
        )
    ) OR EXISTS (
        SELECT 1 FROM "budgets" b
        WHERE b."client_id" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "legacy_client_engagements" l
            WHERE l."client_id" = b."client_id" AND l."engagement_id" = b."engagement_id"
        )
    ) THEN
        RAISE EXCEPTION 'Legacy clients are not migrated to Engagements yet. Run db:migrate:engagements before deploying this migration.';
    END IF;
    DROP TABLE "legacy_client_engagements";
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "budgets_client_id";
--> statement-breakpoint
ALTER TABLE "budgets" DROP COLUMN IF EXISTS "client_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "client_projects";
--> statement-breakpoint
DROP TABLE IF EXISTS "clients";
