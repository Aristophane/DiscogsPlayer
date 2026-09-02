CREATE TYPE "public"."provider_entity_type" AS ENUM('video', 'track', 'album');--> statement-breakpoint
CREATE TYPE "public"."provider_name" AS ENUM('youtube', 'spotify');--> statement-breakpoint
CREATE TYPE "public"."resolution_source" AS ENUM('discogs_video', 'youtube_search', 'spotify_search', 'manual_url');--> statement-breakpoint
CREATE TABLE "provider_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_name" NOT NULL,
	"entity_type" "provider_entity_type" NOT NULL,
	"external_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title_cache" text,
	"artist_cache" text,
	"duration_seconds_cache" integer,
	"thumbnail_url_cache" text,
	"metadata_fetched_at" timestamp with time zone,
	"metadata_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_quota_windows" (
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"configured_limit" integer NOT NULL,
	"estimated_used" integer DEFAULT 0 NOT NULL,
	"reported_used" numeric,
	"exhausted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"provider_entity_id" uuid NOT NULL,
	"source" "resolution_source" NOT NULL,
	"confidence_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spotify_enabled" text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
ALTER TABLE "track_resolutions" ADD CONSTRAINT "track_resolutions_track_id_discogs_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."discogs_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_resolutions" ADD CONSTRAINT "track_resolutions_provider_entity_id_provider_entities_id_fk" FOREIGN KEY ("provider_entity_id") REFERENCES "public"."provider_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_entities_provider_type_external_key" ON "provider_entities" USING btree ("provider","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_quota_windows_pkey" ON "provider_quota_windows" USING btree ("provider","operation","window_start");--> statement-breakpoint
CREATE INDEX "provider_quota_windows_window_idx" ON "provider_quota_windows" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "track_resolutions_track_id_key" ON "track_resolutions" USING btree ("track_id");