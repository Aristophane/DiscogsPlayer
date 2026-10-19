ALTER TABLE "radio_session_tracks" ADD COLUMN "youtube_video_id" text;
--> statement-breakpoint
UPDATE "radio_session_tracks" rst
SET "youtube_video_id" = pe."external_id"
FROM "track_resolutions" tr
JOIN "provider_entities" pe ON pe."id" = tr."provider_entity_id"
WHERE rst."track_id" = tr."track_id"
  AND rst."resolved" = true
  AND pe."provider" = 'youtube';
