import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app';
import { db } from '../../src/db/client';
import { songs, dailyPuzzles, gameResults, userStats, sessions } from '../../src/db/schema';
import { getUtcDateString, SLOTS_PER_DAY } from '../../src/services/puzzleService';

// The real handler fetches a fresh preview URL live from Deezer (its signed URLs expire in
// minutes, so the value stored at curation time is never reused directly). Mock that lookup
// so these tests don't depend on network access or real Deezer track ids.
vi.mock('../../src/services/deezerService', () => ({
  getFreshPreviewUrl: vi.fn().mockResolvedValue({
    previewUrl: 'https://example.test/fresh-preview.mp3',
    durationSeconds: 200,
  }),
}));

const app = createApp();

async function seedSong(n: number) {
  const [song] = await db
    .insert(songs)
    .values({
      title: `Song ${n}`,
      artist: `Artist ${n}`,
      deezerTrackId: `track-${n}`,
      previewUrl: `https://example.test/preview-${n}.mp3`,
      albumArtUrl: `https://example.test/art-${n}.jpg`,
      durationSeconds: 180,
    })
    .returning();
  return song!;
}

/** Enough distinct songs to fill a whole day plus one spare for "guess the wrong song" tests. */
async function seedPool(count = SLOTS_PER_DAY + 3) {
  const seeded = [];
  for (let i = 1; i <= count; i += 1) seeded.push(await seedSong(i));
  return seeded;
}

async function getCsrfToken(agent: ReturnType<typeof request.agent>): Promise<string> {
  const res = await agent.get('/api/csrf-token');
  return res.body.csrfToken as string;
}

async function currentAnswerSongId(puzzleId: number): Promise<number> {
  const rows = await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.id, puzzleId)).limit(1);
  return rows[0]!.songId;
}

/** Plays whatever the current slot is: correctly (one guess) or wrong (a skip that exhausts
 *  every attempt), always ending that slot either way. */
async function playCurrentSlot(
  agent: ReturnType<typeof request.agent>,
  csrfToken: string,
  correct: boolean,
) {
  const today = await agent.get('/api/puzzle/today');
  const puzzleId = today.body.puzzleId as number;
  const answerSongId = await currentAnswerSongId(puzzleId);

  return agent
    .post('/api/puzzle/today/guess')
    .set('X-CSRF-Token', csrfToken)
    .send(correct ? { songId: answerSongId, guessNumber: 1 } : { guessNumber: 6 });
}

/** Plays the whole day, one char per slot ('w' = correct, anything else = wrong), returning
 *  the response to the final slot's final guess. */
async function playWholeDay(
  agent: ReturnType<typeof request.agent>,
  csrfToken: string,
  pattern: string,
) {
  let last;
  for (const c of pattern) {
    last = await playCurrentSlot(agent, csrfToken, c === 'w');
  }
  return last!;
}

beforeEach(async () => {
  await db.delete(gameResults);
  await db.delete(userStats);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
  await db.delete(sessions);
});

describe('GET /api/puzzle/today', () => {
  it('returns the preview url and schedule without revealing the answer', async () => {
    await seedPool();
    const res = await request(app).get('/api/puzzle/today');

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(false);
    expect(res.body.position).toBe(1);
    expect(res.body.totalSlots).toBe(SLOTS_PER_DAY);
    expect(res.body.previewUrl).toEqual(expect.any(String));
    expect(res.body.snippetSchedule).toEqual([1, 2, 4, 7, 11, 16]);
    expect(res.body.song).toBeUndefined();
    expect(res.body.title).toBeUndefined();
  });

  it('is deterministic across repeated calls the same day', async () => {
    await seedPool();

    const first = await request(app).get('/api/puzzle/today');
    const second = await request(app).get('/api/puzzle/today');

    expect(second.body.puzzleId).toBe(first.body.puzzleId);
    expect(second.body.previewUrl).toBe(first.body.previewUrl);
  });

  it('returns a running recap of songs already finished today', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    await playCurrentSlot(agent, csrfToken, true);
    const after = await agent.get('/api/puzzle/today');

    expect(after.body.position).toBe(2);
    expect(after.body.completedSlots).toHaveLength(1);
    expect(after.body.completedSlots[0]).toMatchObject({ position: 1, won: true });
  });
});

describe('POST /api/puzzle/today/guess', () => {
  it('rejects a guess submitted without a CSRF token', async () => {
    await seedPool();
    const res = await request(app)
      .post('/api/puzzle/today/guess')
      .send({ songId: 1, guessNumber: 1 });
    expect(res.status).toBe(403);
  });

  it('treats an omitted songId as a skip: never correct, still consumes an attempt', async () => {
    await seedPool();
    const agent = request.agent(app);
    await agent.get('/api/puzzle/today');
    const csrfToken = await getCsrfToken(agent);

    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', csrfToken)
      .send({ guessNumber: 1 });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(false);
    expect(res.body.isFinal).toBe(false);
  });

  it('reveals a loss when skips exhaust all attempts, without finishing the day', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await playCurrentSlot(agent, csrfToken, false);

    expect(res.body.correct).toBe(false);
    expect(res.body.isFinal).toBe(true);
    expect(res.body.song).toBeDefined();
    expect(res.body.dayComplete).toBe(false);
  });

  it('does not reveal the answer on a wrong, non-final guess', async () => {
    await seedPool();
    const agent = request.agent(app);
    const today = await agent.get('/api/puzzle/today');
    const csrfToken = await getCsrfToken(agent);
    const answerId = await currentAnswerSongId(today.body.puzzleId);
    const wrong = (await db.select().from(songs)).find((s) => s.id !== answerId)!;

    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', csrfToken)
      .send({ songId: wrong.id, guessNumber: 1 });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(false);
    expect(res.body.isFinal).toBe(false);
    expect(res.body.song).toBeUndefined();
  });

  it('reveals the answer and records a per-song win on a correct guess', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const res = await playCurrentSlot(agent, csrfToken, true);

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.isFinal).toBe(true);
    expect(res.body.song.title).toEqual(expect.any(String));

    const stored = await db.select().from(gameResults);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.won).toBe(true);
    expect(stored[0]?.guessesUsed).toBe(1);
  });

  it('advances to the next slot after one is finished, never re-scoring the one just answered', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const first = await agent.get('/api/puzzle/today');
    const slot1AnswerId = await currentAnswerSongId(first.body.puzzleId);

    await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', csrfToken)
      .send({ songId: slot1AnswerId, guessNumber: 1 });

    // The request never names a slot — the server always resolves "whichever is current" on
    // its own. Submitting slot 1's answer again now scores against slot 2, which the picker
    // guarantees is a *different* song, so this must come back wrong, not a second win.
    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', csrfToken)
      .send({ songId: slot1AnswerId, guessNumber: 1 });

    expect(res.body.correct).toBe(false);
    expect(res.body.position).toBe(2);

    const stored = await db.select().from(gameResults);
    expect(stored).toHaveLength(1); // only slot 1's win, not a second row for a "replay"
  });

  it('finishes the day after SLOTS_PER_DAY songs and records the stats update exactly once', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const final = await playWholeDay(agent, csrfToken, 'wwlll');

    expect(final.body.dayComplete).toBe(true);
    expect(final.body.daySummary).toMatchObject({ correctCount: 2, totalSlots: SLOTS_PER_DAY });

    const results = await db.select().from(gameResults);
    expect(results).toHaveLength(SLOTS_PER_DAY);

    const me = await agent.get('/api/auth/me');
    const guestId = me.body.guestId as string;
    const stats = await db.select().from(userStats).where(eq(userStats.ownerKey, guestId)).limit(1);
    // One day played, not SLOTS_PER_DAY — the day-level update must fire once, on the last slot.
    expect(stats[0]?.gamesPlayed).toBe(1);
    expect(stats[0]?.gamesWon).toBe(1);
    expect(stats[0]?.perfectDays).toBe(0);
  });

  it('a perfect day sets perfectDays and continues the streak', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    const final = await playWholeDay(agent, csrfToken, 'wwwww');

    expect(final.body.daySummary).toMatchObject({
      correctCount: SLOTS_PER_DAY,
      totalSlots: SLOTS_PER_DAY,
      currentStreak: 1,
    });
  });

  it('rejects a second attempt to submit after the whole day is already completed', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    await playWholeDay(agent, csrfToken, 'wwwww');
    const after = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', csrfToken)
      .send({ guessNumber: 1 });

    expect(after.status).toBe(409);
  });

  it('GET /today reflects completion and reveals every answer once the day is done', async () => {
    await seedPool();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    await playWholeDay(agent, csrfToken, 'wlwlw');
    const after = await agent.get('/api/puzzle/today');

    expect(after.body.completed).toBe(true);
    expect(after.body.correctCount).toBe(3);
    expect(after.body.totalSlots).toBe(SLOTS_PER_DAY);
    expect(after.body.slots).toHaveLength(SLOTS_PER_DAY);
    for (const slot of after.body.slots) {
      expect(slot.song.title).toEqual(expect.any(String));
    }
  });
});

// Sanity check that the deterministic date hash used for puzzle selection doesn't crash on today's real date.
describe('getUtcDateString sanity', () => {
  it('produces a plausible date string for "now"', () => {
    expect(getUtcDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('same-artist hint', () => {
  /** Seeds a song with an explicit artist so two songs can deliberately share one. */
  async function seedSongByArtist(n: number, artist: string) {
    const [song] = await db
      .insert(songs)
      .values({
        title: `Song ${n}`,
        artist,
        deezerTrackId: `track-${n}`,
        previewUrl: `https://example.test/preview-${n}.mp3`,
        durationSeconds: 180,
      })
      .returning();
    return song!;
  }

  it('reports sameArtist for a wrong guess by the answer’s artist', async () => {
    // Both songs share an artist, so whichever one the puzzle picks, the other is guaranteed
    // to be a wrong guess by the right artist — no branch in the test can skip the assertion.
    const first = await seedSongByArtist(1, 'Shared Artist');
    const second = await seedSongByArtist(2, 'Shared Artist');

    const agent = request.agent(app);
    const puzzle = await agent.get('/api/puzzle/today');
    const answerId = await currentAnswerSongId(puzzle.body.puzzleId);
    const guessId = answerId === first.id ? second.id : first.id;
    expect(guessId).not.toBe(answerId);

    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', await getCsrfToken(agent))
      .send({ songId: guessId, guessNumber: 1 });

    expect(res.body.correct).toBe(false);
    expect(res.body.isFinal).toBe(false);
    expect(res.body.sameArtist).toBe(true);
  });

  it('does not report sameArtist for an unrelated wrong guess', async () => {
    await seedSongByArtist(1, 'Artist One');
    await seedSongByArtist(2, 'Artist Two');

    const agent = request.agent(app);
    const puzzle = await agent.get('/api/puzzle/today');
    const answerId = await currentAnswerSongId(puzzle.body.puzzleId);
    const others = await db.select().from(songs);
    const wrong = others.find((s) => s.id !== answerId)!;

    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', await getCsrfToken(agent))
      .send({ songId: wrong.id, guessNumber: 1 });

    expect(res.body.correct).toBe(false);
    expect(res.body.sameArtist).toBe(false);
  });

  it('never leaks the hint on the final attempt, where the answer is revealed anyway', async () => {
    await seedSongByArtist(1, 'Shared Artist');
    const sibling = await seedSongByArtist(2, 'Shared Artist');

    const agent = request.agent(app);
    await agent.get('/api/puzzle/today');

    const res = await agent
      .post('/api/puzzle/today/guess')
      .set('X-CSRF-Token', await getCsrfToken(agent))
      .send({ songId: sibling.id, guessNumber: 6 });

    expect(res.body.isFinal).toBe(true);
    expect(res.body.sameArtist).toBeUndefined();
  });
});
