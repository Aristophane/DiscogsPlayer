DROP INDEX "tasks_claimable_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_claimable_idx" ON "tasks" USING btree ("priority" desc,"run_after") WHERE "tasks"."status" in ('queued', 'retry_wait');