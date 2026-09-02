CREATE TABLE "radio_session_tracks" (
	"session_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"resolved" boolean NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	"play_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radio_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filter_genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"filter_styles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "radio_session_tracks" ADD CONSTRAINT "radio_session_tracks_session_id_radio_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."radio_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_session_tracks" ADD CONSTRAINT "radio_session_tracks_track_id_discogs_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."discogs_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radio_sessions" ADD CONSTRAINT "radio_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "radio_session_tracks_pkey" ON "radio_session_tracks" USING btree ("session_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radio_session_tracks_order_key" ON "radio_session_tracks" USING btree ("session_id","play_order");--> statement-breakpoint
CREATE UNIQUE INDEX "radio_sessions_one_active_per_user" ON "radio_sessions" USING btree ("user_id") WHERE "radio_sessions"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "radio_sessions_user_created_idx" ON "radio_sessions" USING btree ("user_id","created_at");