import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../src/app';
import { db } from '../../src/db/client';
import {
  appSettings,
  artistChallenges,
  artistChallengeTracks,
  artistRoundGuesses,
  artistSessionResults,
  dailyPuzzles,
  dailyPuzzleStarts,
  gameResults,
  sessions,
  songs,
  users,
} from '../../src/db/schema';
import { getUtcDateString } from '../../src/services/puzzleService';
import { getSettings, invalidateSettingsCache } from '../../src/services/settingsService';

const app = createApp();

/** Has to clear `passwordProblems`: not a common password, no run of sequential characters, and
 *  nothing derived from the account's own email or display name. */
const TEST_PASSWORD = 'trombone-marmalade-77';

function dateOffsetDays(days: number): string {
  return getUtcDateString(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

async function getCsrfToken(agent: ReturnType<typeof request.agent>): Promise<string> {
  const res = await agent.get('/api/csrf-token');
  return res.body.csrfToken as string;
}

async function seedSong(id: number, title: string, curated = true, active = true) {
  await db.insert(songs).values({
    id,
    title,
    artist: 'Test Artist',
    deezerTrackId: `admin-dz-${id}`,
    previewUrl: 'https://example.test/p.mp3',
    durationSeconds: 200,
    active,
    manualOverride: curated,
  });
}

/** Registers an account through the API (so the password hash is real) and optionally promotes
 *  it — the admin flag is only ever set directly in the database, never by a route. */
async function signIn(email: string, admin: boolean) {
  const agent = request.agent(app);
  const csrf = await getCsrfToken(agent);
  const res = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ email, password: TEST_PASSWORD, displayName: email.split('@')[0] });

  if (admin) {
    await db.update(users).set({ isAdmin: true }).where(eq(users.email, email));
  }
  return { agent, userId: res.body.user.id as string, csrf: await getCsrfToken(agent) };
}

beforeEach(async () => {
  await db.delete(gameResults);
  await db.delete(dailyPuzzleStarts);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
  await db.delete(sessions);
  // Artist/category runs from earlier test files reference `users`, so they have to go first or
  // the delete below trips their foreign key.
  await db.delete(artistRoundGuesses);
  await db.delete(artistSessionResults);
  await db.delete(artistChallengeTracks);
  await db.delete(artistChallenges);
  await db.delete(users);
  await db.delete(appSettings);
  invalidateSettingsCache();
});

describe('admin route access', () => {
  it('hides the routes from anonymous visitors', async () => {
    const res = await request(app).get('/api/admin/daily-puzzles');
    expect(res.status).toBe(404);
  });

  it('hides the routes from ordinary logged-in users', async () => {
    const { agent } = await signIn('plain@example.test', false);
    const res = await agent.get('/api/admin/daily-puzzles');
    // 404 rather than 403 on purpose: a 403 would confirm the endpoint exists.
    expect(res.status).toBe(404);
  });

  it('lets an admin through', async () => {
    const { agent } = await signIn('boss@example.test', true);
    const res = await agent.get('/api/admin/daily-puzzles');
    expect(res.status).toBe(200);
    expect(res.body.puzzles).toEqual([]);
  });

  it('stops reporting isAdmin once the flag is revoked', async () => {
    const { agent } = await signIn('boss@example.test', true);
    expect(await agent.get('/api/admin/dashboard').then((r) => r.status)).toBe(200);

    await db.update(users).set({ isAdmin: false }).where(eq(users.email, 'boss@example.test'));

    // Same session, no re-login — the flag is read per request, not cached in the session.
    expect(await agent.get('/api/admin/dashboard').then((r) => r.status)).toBe(404);
  });
});

describe('GET /api/admin/daily-puzzles', () => {
  it('lists the schedule with each song’s position and play count', async () => {
    const { agent, userId } = await signIn('boss@example.test', true);
    await seedSong(1, 'Scheduled Song');
    await seedSong(2, 'Second Song');
    const date = dateOffsetDays(1);
    const inserted = await db
      .insert(dailyPuzzles)
      .values([
        { puzzleDate: date, position: 1, songId: 1 },
        { puzzleDate: date, position: 2, songId: 2 },
      ])
      .returning();
    await db.insert(gameResults).values({
      userId,
      puzzleId: inserted[0]!.id,
      won: true,
      guessesUsed: 2,
      snippetStageReached: 2,
    });

    const res = await agent.get('/api/admin/daily-puzzles');

    expect(res.status).toBe(200);
    expect(res.body.today).toBe(getUtcDateString());
    expect(res.body.puzzles).toHaveLength(2);
    expect(res.body.puzzles[0]).toMatchObject({ position: 1, title: 'Scheduled Song', plays: 1 });
    expect(res.body.puzzles[1]).toMatchObject({ position: 2, title: 'Second Song', plays: 0 });
    // COUNT(*) comes back as a string from postgres-js unless it is cast, and the UI does
    // arithmetic on this.
    expect(typeof res.body.puzzles[0].plays).toBe('number');
  });
});

describe('PUT /api/admin/daily-puzzles/:date/:position', () => {
  it('schedules a slot on a future date', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Tomorrow’s Song');
    const date = dateOffsetDays(3);

    const res = await agent
      .put(`/api/admin/daily-puzzles/${date}/1`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 1 });

    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.puzzleDate, date), eq(dailyPuzzles.position, 1)));
    expect(rows[0]?.songId).toBe(1);
  });

  it('replaces the song on an unplayed slot', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'First');
    await seedSong(2, 'Second');
    const date = dateOffsetDays(3);
    await db.insert(dailyPuzzles).values({ puzzleDate: date, position: 1, songId: 1 });

    const res = await agent
      .put(`/api/admin/daily-puzzles/${date}/1`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 2 });

    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.puzzleDate, date), eq(dailyPuzzles.position, 1)));
    expect(rows[0]?.songId).toBe(2);
  });

  it('refuses to rewrite a song people have already played', async () => {
    const { agent, csrf, userId } = await signIn('boss@example.test', true);
    await seedSong(1, 'Played');
    await seedSong(2, 'Replacement');
    const date = dateOffsetDays(1);
    const inserted = await db
      .insert(dailyPuzzles)
      .values({ puzzleDate: date, position: 1, songId: 1 })
      .returning();
    await db.insert(gameResults).values({
      userId,
      puzzleId: inserted[0]!.id,
      won: true,
      guessesUsed: 1,
      snippetStageReached: 1,
    });

    const res = await agent
      .put(`/api/admin/daily-puzzles/${date}/1`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 2 });

    expect(res.status).toBe(409);
    const rows = await db
      .select()
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.puzzleDate, date), eq(dailyPuzzles.position, 1)));
    expect(rows[0]?.songId).toBe(1);
  });

  it('leaves a sibling slot on the same date editable when one slot is locked', async () => {
    const { agent, csrf, userId } = await signIn('boss@example.test', true);
    await seedSong(1, 'Played');
    await seedSong(2, 'Untouched');
    await seedSong(3, 'Replacement');
    const date = dateOffsetDays(1);
    const inserted = await db
      .insert(dailyPuzzles)
      .values([
        { puzzleDate: date, position: 1, songId: 1 },
        { puzzleDate: date, position: 2, songId: 2 },
      ])
      .returning();
    await db.insert(gameResults).values({
      userId,
      puzzleId: inserted[0]!.id,
      won: true,
      guessesUsed: 1,
      snippetStageReached: 1,
    });

    // Position 1 is locked (played), but position 2 on the same date never was.
    const res = await agent
      .put(`/api/admin/daily-puzzles/${date}/2`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 3 });

    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.puzzleDate, date), eq(dailyPuzzles.position, 2)));
    expect(rows[0]?.songId).toBe(3);
  });

  it('refuses to touch a past date', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Yesterday');

    const res = await agent
      .put(`/api/admin/daily-puzzles/${dateOffsetDays(-1)}/1`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 1 });

    expect(res.status).toBe(409);
  });

  it('refuses to schedule an inactive song', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Withdrawn', true, false);

    const res = await agent
      .put(`/api/admin/daily-puzzles/${dateOffsetDays(2)}/1`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 1 });

    expect(res.status).toBe(409);
  });

  it('rejects a position outside 1..SLOTS_PER_DAY', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Song');

    const res = await agent
      .put(`/api/admin/daily-puzzles/${dateOffsetDays(2)}/6`)
      .set('X-CSRF-Token', csrf)
      .send({ songId: 1 });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/daily-puzzles/:date/:position', () => {
  it('unschedules an unplayed slot', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Doomed');
    const date = dateOffsetDays(2);
    await db.insert(dailyPuzzles).values({ puzzleDate: date, position: 1, songId: 1 });

    const res = await agent.delete(`/api/admin/daily-puzzles/${date}/1`).set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect(await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.puzzleDate, date))).toEqual(
      [],
    );
  });

  it('refuses to delete a played slot, which would orphan its results', async () => {
    const { agent, csrf, userId } = await signIn('boss@example.test', true);
    await seedSong(1, 'Played');
    const date = dateOffsetDays(1);
    const inserted = await db
      .insert(dailyPuzzles)
      .values({ puzzleDate: date, position: 1, songId: 1 })
      .returning();
    await db.insert(gameResults).values({
      userId,
      puzzleId: inserted[0]!.id,
      won: false,
      guessesUsed: 6,
      snippetStageReached: 6,
    });

    const res = await agent.delete(`/api/admin/daily-puzzles/${date}/1`).set('X-CSRF-Token', csrf);

    expect(res.status).toBe(409);
    expect(
      await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.puzzleDate, date)),
    ).toHaveLength(1);
  });
});

describe('PATCH /api/admin/songs/:songId', () => {
  it('moves a song into the curated pool', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await seedSong(1, 'Chart Entry', false);

    const res = await agent
      .patch('/api/admin/songs/1')
      .set('X-CSRF-Token', csrf)
      .send({ manualOverride: true });

    expect(res.status).toBe(200);
    expect(res.body.song.manualOverride).toBe(true);
  });
});

describe('admin settings', () => {
  it('describes every tunable with its value, default and control', async () => {
    const { agent } = await signIn('boss@example.test', true);

    const res = await agent.get('/api/admin/settings');

    expect(res.status).toBe(200);
    const rounds = (res.body.settings as { key: string }[]).find(
      (s) => s.key === 'challengeRounds',
    );
    expect(rounds).toMatchObject({
      value: 10,
      default: 10,
      isDefault: true,
      control: { kind: 'number' },
    });
  });

  it('saves a change and makes it the value the game reads', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);

    const res = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ updates: [{ key: 'challengeRounds', value: 20 }] });

    expect(res.status).toBe(200);
    expect((await getSettings()).challengeRounds).toBe(20);

    // And the public config the client reads reflects it too.
    const config = await request(app).get('/api/config');
    expect(config.body.challengeRounds).toBe(20);
  });

  it('rejects an out-of-range value with the reason, and changes nothing', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);

    const res = await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      // Comfortably above the 100 ceiling. Deliberately not just over it, so it stays invalid
      // if the cap moves again — this test broke once already when 999 stopped being too big.
      .send({ updates: [{ key: 'multiplayerMaxPlayers', value: 99999 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Players per room');
    expect((await getSettings()).multiplayerMaxPlayers).toBe(8);
  });

  it('resets a setting back to its default', async () => {
    const { agent, csrf } = await signIn('boss@example.test', true);
    await agent
      .patch('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ updates: [{ key: 'challengeRounds', value: 25 }] });

    const res = await agent
      .post('/api/admin/settings/challengeRounds/reset')
      .set('X-CSRF-Token', csrf);

    expect(res.status).toBe(200);
    expect((await getSettings()).challengeRounds).toBe(10);
  });

  it('is not reachable by a non-admin', async () => {
    const { agent, csrf } = await signIn('plain@example.test', false);

    expect(await agent.get('/api/admin/settings').then((r) => r.status)).toBe(404);
    expect(
      await agent
        .patch('/api/admin/settings')
        .set('X-CSRF-Token', csrf)
        .send({ updates: [{ key: 'challengeRounds', value: 30 }] })
        .then((r) => r.status),
    ).toBe(404);
    expect((await getSettings()).challengeRounds).toBe(10);
  });
});

describe('GET /api/admin/dashboard', () => {
  it('returns the command-centre metrics in one payload', async () => {
    const { agent } = await signIn('boss@example.test', true);
    await seedSong(1, 'Something');

    const res = await agent.get('/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.content).toMatchObject({ total: 1, active: 1, curated: 1 });
    expect(res.body.players.admins).toBe(1);
    expect(typeof res.body.activity.dailyPlays24h).toBe('number');
    expect(typeof res.body.caches.pools).toBe('number');
    expect(res.body.liveRooms).toMatchObject({ total: expect.any(Number) });
  });
});
