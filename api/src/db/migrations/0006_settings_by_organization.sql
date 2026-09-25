UPDATE "settings" AS s
SET "org_account_id" = od."organization_id",
    "dao_account_id" = od."dao_account_id"
FROM "organization_daos" AS od
WHERE s."org_account_id" = od."dao_account_id"
  AND NOT EXISTS (
    SELECT 1 FROM "settings" AS existing WHERE existing."org_account_id" = od."organization_id"
  );
