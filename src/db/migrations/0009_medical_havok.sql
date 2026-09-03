ALTER TABLE "random_sessions" ADD COLUMN "collection_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "radio_sessions" ADD COLUMN "collection_owner_id" uuid;--> statement-breakpoint
-- Rétrocompatibilité (Lot 7, partage) : avant cette colonne, une session ne pouvait
-- tirer que de sa propre collection — c'est donc la seule valeur possible pour toute
-- ligne déjà existante, jamais une supposition.
UPDATE "random_sessions" SET "collection_owner_id" = "user_id" WHERE "collection_owner_id" IS NULL;--> statement-breakpoint
UPDATE "radio_sessions" SET "collection_owner_id" = "user_id" WHERE "collection_owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "random_sessions" ALTER COLUMN "collection_owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "radio_sessions" ALTER COLUMN "collection_owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "random_sessions" ADD CONSTRAINT "random_sessions_collection_owner_id_users_id_fk" FOREIGN KEY ("collection_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_sessions" ADD CONSTRAINT "radio_sessions_collection_owner_id_users_id_fk" FOREIGN KEY ("collection_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
