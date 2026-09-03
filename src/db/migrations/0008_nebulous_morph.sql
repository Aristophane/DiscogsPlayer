CREATE TABLE "collection_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "viewing_as_user_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_invites" ADD CONSTRAINT "collection_invites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_invites" ADD CONSTRAINT "collection_invites_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_shares" ADD CONSTRAINT "collection_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_shares" ADD CONSTRAINT "collection_shares_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_invites_token_hash_key" ON "collection_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "collection_invites_owner_id_idx" ON "collection_invites" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_shares_active_pair_idx" ON "collection_shares" USING btree ("owner_id","grantee_id") WHERE "collection_shares"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "collection_shares_grantee_id_idx" ON "collection_shares" USING btree ("grantee_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_viewing_as_user_id_users_id_fk" FOREIGN KEY ("viewing_as_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;