ALTER TABLE "discogs_releases" ADD COLUMN "community_have" integer;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "community_want" integer;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "lowest_price_eur" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "num_for_sale" integer;--> statement-breakpoint
ALTER TABLE "discogs_releases" ADD COLUMN "statistics_fetched_at" timestamp with time zone;