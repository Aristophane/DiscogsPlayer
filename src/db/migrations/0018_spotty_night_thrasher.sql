ALTER TABLE "discogs_releases" ADD COLUMN "community_rating" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "community_rating_count" integer;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "community_rating_fetched_at" timestamp with time zone;