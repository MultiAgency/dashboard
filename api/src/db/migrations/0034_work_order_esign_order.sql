ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "esign_representative_first" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "work_orders" AS w
SET "signed_drive_file_id" = d."drive_file_id",
    "signed_drive_url" = COALESCE(d."drive_url", 'https://drive.google.com/file/d/' || d."drive_file_id" || '/view')
FROM (
  SELECT DISTINCT ON ("work_order_id") "work_order_id", "drive_file_id", "drive_url"
  FROM "work_order_documents"
  WHERE "kind" = 'signed' AND "drive_file_id" IS NOT NULL
  ORDER BY "work_order_id", "created_at" DESC
) AS d
WHERE w."id" = d."work_order_id" AND w."signed_drive_file_id" IS NULL;
