import { beforeAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { env } from '../src/env';

/**
 * Last line of defence before the suite starts deleting rows: integration tests truncate
 * `songs`, `daily_puzzles`, `sessions` and friends, so a misconfigured `DATABASE_URL` pointed
 * at the real database would silently wipe the song bank. Requiring a `_test` database name
 * makes that mistake impossible rather than merely unlikely.
 */
function assertTestDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}": the test suite deletes rows and ` +
        `requires a database whose name ends in "_test". Set DATABASE_URL_TEST to override.`,
    );
  }
}

/**
 * Every table the suite writes to, cleared between files.
 *
 * Each test file already resets what it cares about, but only what it cares about — so a file
 * that finishes with rows in `artist_session_results` used to break the *next* file's
 * `delete from users`, which fails on the foreign key. Which files collide depended on the
 * order vitest happened to run them in, making the failures look random. One CASCADE truncate
 * per file removes the coupling entirely. Files run serially (`fileParallelism: false`), so
 * this can never wipe another file's data mid-run.
 */
const TABLES = [
  'events',
  'playlists',
  'messages',
  'friendships',
  'password_reset_tokens',
  'duels',
  // Settings are global game rules, so a row left behind by one file silently changes how every
  // later file's game behaves — a leftover 20-song run length made ten-round test loops stop
  // short and their leaderboard assertions fail with no obvious connection to the cause.
  'app_settings',
  'survival_runs',
  'artist_round_guesses',
  'artist_session_results',
  'artist_challenge_tracks',
  'artist_challenges',
  'artist_track_pools',
  'daily_puzzle_starts',
  'game_results',
  'daily_puzzles',
  'user_stats',
  'sessions',
  'users',
  'songs',
];

beforeAll(async () => {
  assertTestDatabase();
  await migrate(db, { migrationsFolder: `${__dirname}/../src/db/migrations` });
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
});
