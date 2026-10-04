CREATE TABLE "builder_accounts" (
	"builder_id" text NOT NULL,
	"network" text NOT NULL,
	"account" text NOT NULL,
	"proof" text NOT NULL,
	"verified_at" timestamp NOT NULL,
	CONSTRAINT "builder_accounts_builder_id_network_pk" PRIMARY KEY("builder_id","network"),
	CONSTRAINT "builder_accounts_network_check" CHECK ("builder_accounts"."network" in ('testnet', 'mainnet'))
);
--> statement-breakpoint
CREATE TABLE "builder_admissions" (
	"builder_id" text NOT NULL,
	"network" text NOT NULL,
	"status" text NOT NULL,
	"proof_url" text,
	"admitted_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "builder_admissions_builder_id_network_pk" PRIMARY KEY("builder_id","network"),
	CONSTRAINT "builder_admissions_network_check" CHECK ("builder_admissions"."network" in ('testnet', 'mainnet')),
	CONSTRAINT "builder_admissions_status_check" CHECK ("builder_admissions"."status" in ('admitted', 'suspended', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "builder_agreements" (
	"builder_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"attested_at" timestamp NOT NULL,
	"proof" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "builders" ALTER COLUMN "near_account" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "builders" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "builders" ADD COLUMN "kind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "builders" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "builder_accounts" ADD CONSTRAINT "builder_accounts_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_admissions" ADD CONSTRAINT "builder_admissions_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_agreements" ADD CONSTRAINT "builder_agreements_builder_id_builders_id_fk" FOREIGN KEY ("builder_id") REFERENCES "public"."builders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builder_accounts_network_account_idx" ON "builder_accounts" USING btree ("network","account");--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_operator_id_builders_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."builders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_github_login_unique" UNIQUE("github_login");--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_kind_check" CHECK ("builders"."kind" in ('human', 'agent'));--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_operator_check" CHECK (("builders"."kind" = 'agent') = ("builders"."operator_id" is not null));--> statement-breakpoint
ALTER TABLE "builders" ADD CONSTRAINT "builders_github_login_check" CHECK ("builders"."github_login" = lower("builders"."github_login"));