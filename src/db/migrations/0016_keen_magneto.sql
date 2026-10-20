ALTER TABLE "feed_editions" ADD COLUMN "enrichment_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_editions" ADD COLUMN "retry_at" timestamp with time zone;