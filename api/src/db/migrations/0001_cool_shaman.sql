UPDATE "agency_settings" SET headline = 'Open Books · Open Source · Open Doors' WHERE headline = 'Always building. Always open.';--> statement-breakpoint
UPDATE "agency_settings" SET tagline = 'The future of work is near…' WHERE tagline = 'Join our agency. Hire us. Launch your own.';--> statement-breakpoint
UPDATE "agency_settings" SET contact_email = 'multiagentic@gmail.com' WHERE contact_email IS NULL;--> statement-breakpoint
ALTER TABLE "agency_settings" ALTER COLUMN "headline" SET DEFAULT 'Open Books · Open Source · Open Doors';--> statement-breakpoint
ALTER TABLE "agency_settings" ALTER COLUMN "tagline" SET DEFAULT 'The future of work is near…';--> statement-breakpoint
ALTER TABLE "agency_settings" ALTER COLUMN "contact_email" SET DEFAULT 'multiagentic@gmail.com';
