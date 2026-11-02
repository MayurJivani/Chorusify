DROP INDEX "daily_puzzles_date_position_idx";--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN "edition" text DEFAULT 'english' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "featured_artists" jsonb;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "album" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "release_year" integer;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "genre" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "scene" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "daily_edition" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "difficulty" integer;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "isrc" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "aliases" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_puzzles_edition_date_position_idx" ON "daily_puzzles" USING btree ("edition","puzzle_date","position");