ALTER TABLE "discogs_artists" ADD COLUMN "origin_countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discogs_artists" ADD COLUMN "origin_source_url" text;--> statement-breakpoint
ALTER TABLE "discogs_artists" ADD COLUMN "origin_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discogs_artists" ADD COLUMN "origin_next_check_at" timestamp with time zone;