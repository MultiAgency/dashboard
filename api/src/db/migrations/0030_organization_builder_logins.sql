CREATE TABLE IF NOT EXISTS "organization_builder_logins" (
    "organization_id" text NOT NULL,
    "near_account" text NOT NULL,
    "github_login" text NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    PRIMARY KEY ("organization_id", "near_account")
);
