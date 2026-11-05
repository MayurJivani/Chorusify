-- A trial song picked on its own becomes a ticked song in its playlist before the column goes.
UPDATE "playlists" SET "tracks" = "tracks" || jsonb_build_array("trial_track" || '{"trial": true}'::jsonb) WHERE "trial_track" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" DROP COLUMN "trial_track";
