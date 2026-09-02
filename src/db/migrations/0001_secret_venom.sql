CREATE TYPE "public"."track_type" AS ENUM('track', 'heading', 'index');--> statement-breakpoint
CREATE TYPE "public"."sync_kind" AS ENUM('initial', 'manual', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'retry_wait', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "discogs_artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discogs_artist_id" text,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discogs_release_artists" (
	"release_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"join_text" text
);
--> statement-breakpoint
CREATE TABLE "discogs_release_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"url_canonical" text NOT NULL,
	"provider" text DEFAULT 'youtube' NOT NULL,
	"external_id" text,
	"title" text,
	"duration_seconds" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discogs_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discogs_release_id" text NOT NULL,
	"master_id" text,
	"title" text NOT NULL,
	"year" integer,
	"country" text,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"styles" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_image_url" text,
	"artists_text" text DEFAULT '' NOT NULL,
	"raw_source_updated_at" timestamp with time zone,
	"details_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discogs_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"discogs_position" text DEFAULT '' NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"duration_seconds" integer,
	"type" "track_type" DEFAULT 'track' NOT NULL,
	"extra_artists" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"discogs_instance_id" text NOT NULL,
	"discogs_folder_id" text,
	"rating" integer,
	"date_added" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_sync_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "sync_kind" NOT NULL,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"pages_total" integer,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_changed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error_code" text,
	"last_error_message" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discogs_release_artists" ADD CONSTRAINT "discogs_release_artists_release_id_discogs_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."discogs_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discogs_release_artists" ADD CONSTRAINT "discogs_release_artists_artist_id_discogs_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."discogs_artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discogs_release_videos" ADD CONSTRAINT "discogs_release_videos_release_id_discogs_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."discogs_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discogs_tracks" ADD CONSTRAINT "discogs_tracks_release_id_discogs_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."discogs_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_instances" ADD CONSTRAINT "collection_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_instances" ADD CONSTRAINT "collection_instances_release_id_discogs_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."discogs_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_instances" ADD CONSTRAINT "collection_instances_last_seen_sync_id_sync_runs_id_fk" FOREIGN KEY ("last_seen_sync_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discogs_artists_discogs_artist_id_key" ON "discogs_artists" USING btree ("discogs_artist_id") WHERE "discogs_artists"."discogs_artist_id" is not null;--> statement-breakpoint
CREATE INDEX "discogs_artists_name_normalized_idx" ON "discogs_artists" USING btree ("name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "discogs_release_artists_release_position_key" ON "discogs_release_artists" USING btree ("release_id","position");--> statement-breakpoint
CREATE INDEX "discogs_release_artists_artist_idx" ON "discogs_release_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discogs_release_videos_release_url_key" ON "discogs_release_videos" USING btree ("release_id","url_canonical");--> statement-breakpoint
CREATE UNIQUE INDEX "discogs_releases_discogs_release_id_key" ON "discogs_releases" USING btree ("discogs_release_id");--> statement-breakpoint
CREATE INDEX "discogs_releases_genres_idx" ON "discogs_releases" USING gin ("genres");--> statement-breakpoint
CREATE INDEX "discogs_releases_styles_idx" ON "discogs_releases" USING gin ("styles");--> statement-breakpoint
CREATE INDEX "discogs_releases_details_fetched_at_idx" ON "discogs_releases" USING btree ("details_fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discogs_tracks_release_ordinal_key" ON "discogs_tracks" USING btree ("release_id","ordinal");--> statement-breakpoint
CREATE INDEX "discogs_tracks_title_normalized_idx" ON "discogs_tracks" USING btree ("title_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_instances_user_instance_key" ON "collection_instances" USING btree ("user_id","discogs_instance_id");--> statement-breakpoint
CREATE INDEX "collection_instances_user_active_idx" ON "collection_instances" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "collection_instances_release_idx" ON "collection_instances" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_active_per_user" ON "sync_runs" USING btree ("user_id") WHERE "sync_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "sync_runs_user_created_idx" ON "sync_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_claimable_idx" ON "tasks" USING btree ("run_after") WHERE "tasks"."status" in ('queued', 'retry_wait');--> statement-breakpoint
CREATE INDEX "tasks_locked_idx" ON "tasks" USING btree ("locked_at") WHERE "tasks"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_key_active_idx" ON "tasks" USING btree ("dedupe_key") WHERE "tasks"."status" in ('queued', 'running', 'retry_wait');