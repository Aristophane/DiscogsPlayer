CREATE TABLE "random_session_releases" (
	"session_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draw_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filter_genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"filter_styles" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "random_session_releases" ADD CONSTRAINT "random_session_releases_session_id_random_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."random_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_session_releases" ADD CONSTRAINT "random_session_releases_release_id_discogs_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."discogs_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_sessions" ADD CONSTRAINT "random_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "random_session_releases_pkey" ON "random_session_releases" USING btree ("session_id","release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "random_session_releases_order_key" ON "random_session_releases" USING btree ("session_id","draw_order");--> statement-breakpoint
CREATE UNIQUE INDEX "random_sessions_one_active_per_user" ON "random_sessions" USING btree ("user_id") WHERE "random_sessions"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "random_sessions_user_created_idx" ON "random_sessions" USING btree ("user_id","created_at");