CREATE TABLE "feed_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"discogs_release_id" text NOT NULL,
	"day" text NOT NULL,
	"position" integer NOT NULL,
	"content_key" text NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_source_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_editions" ADD CONSTRAINT "feed_editions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_edition_id_feed_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."feed_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_editions_user_day_key" ON "feed_editions" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_posts_user_content_key" ON "feed_posts" USING btree ("user_id","content_key");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_posts_edition_position_key" ON "feed_posts" USING btree ("edition_id","position");--> statement-breakpoint
CREATE INDEX "feed_posts_page_idx" ON "feed_posts" USING btree ("user_id","day","position");