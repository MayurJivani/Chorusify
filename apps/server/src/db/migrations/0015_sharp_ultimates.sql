CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"password_hash" text,
	"audio_mode" text NOT NULL,
	"host_plays" boolean DEFAULT false NOT NULL,
	"rounds" integer NOT NULL,
	"playback_seconds" integer NOT NULL,
	"guess_seconds" integer NOT NULL,
	"max_points" integer NOT NULL,
	"min_points" integer NOT NULL,
	"first_bonus" integer NOT NULL,
	"playlist_id" text,
	"tracks" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "events_code_unique" UNIQUE("code"),
	CONSTRAINT "events_audio_mode_check" CHECK ("events"."audio_mode" in ('everyone_plays', 'host_only')),
	CONSTRAINT "events_status_check" CHECK ("events"."status" in ('open', 'live', 'ended')),
	CONSTRAINT "events_visibility_check" CHECK ("events"."visibility" in ('public', 'unlisted'))
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"tracks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "events_visibility_status_idx" ON "events" USING btree ("visibility","status");--> statement-breakpoint
CREATE INDEX "playlists_owner_idx" ON "playlists" USING btree ("owner_user_id","updated_at");