import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// The suite used to read `process.env.DATABASE_URL` here and always miss it: dotenv is loaded
// by `src/env.ts`, which is imported by the *tests*, long after this config is evaluated. The
// fallback then pointed at a localhost Postgres nobody runs, so every file failed on connect.
loadDotenv({ path: resolve(here, '.env'), quiet: true });

/**
 * Integration tests truncate `songs`, `daily_puzzles`, `sessions`, … so they must never touch
 * the development/production database. `DATABASE_URL_TEST` wins if set; otherwise the app's
 * own connection string is reused with `_test` appended to the database name, which keeps the
 * host and credentials but guarantees a different database. `test/setup.ts` re-checks the
 * `_test` suffix before running anything.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST;
  if (explicit) return explicit;

  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) return 'postgres://postgres:postgres@localhost:5432/chorusify_test';

  const url = new URL(appUrl);
  const name = url.pathname.replace(/^\//, '') || 'chorusify';
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url.toString();
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: resolveTestDatabaseUrl(),
      SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
      CSRF_SECRET: 'test-csrf-secret-at-least-32-characters-long-x',
      CORS_ORIGIN: 'http://localhost:5173',
      ADMIN_EMAIL: 'boss@example.test',
      ADMIN_REGISTRATION_OPEN: 'true',
    },
    fileParallelism: false,
    // Local development talks to Postgres through a port-forward (~30ms round-trip), so
    // DB-heavy integration tests are dominated by network latency: the per-challenge
    // leaderboard test alone plays two full 10-round sessions, which is several hundred
    // sequential queries. CI runs against a local Postgres and finishes far inside this.
    testTimeout: 120000,
    // Same reason, for setup/teardown: a `beforeEach` that clears five tables is five
    // sequential round trips, which intermittently exceeded the 10s default once the rest of
    // the suite had the connection busy. Raised in step with testTimeout rather than left to
    // fail as a flake that looks like a real assertion error.
    hookTimeout: 120000,
  },
});
