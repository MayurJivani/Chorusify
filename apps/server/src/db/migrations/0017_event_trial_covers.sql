ALTER TABLE "events" ADD COLUMN "trial_track" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "show_covers" boolean DEFAULT false NOT NULL;