ALTER TABLE "daily_puzzles" DROP CONSTRAINT "daily_puzzles_puzzle_date_unique";--> statement-breakpoint
DROP INDEX "daily_puzzles_date_idx";--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN "position" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "perfect_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_puzzles_date_position_idx" ON "daily_puzzles" USING btree ("puzzle_date","position");