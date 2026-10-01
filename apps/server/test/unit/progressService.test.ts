import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../src/db/client';
import {
  artistChallenges,
  artistSessionResults,
  dailyPuzzles,
  gameResults,
  songs,
  survivalRuns,
  userStats,
  users,
} from '../../src/db/schema';
import { recordGameResult } from '../../src/services/statsService';

vi.mock('../../src/services/deezerService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/deezerService')>();
  return { ...actual };
});

import { getProgress, levelForXp, xpForLevel } from '../../src/services/progressService';

const guest = { userId: null, guestId: 'progress-guest' };

/** A completed run, written directly so the test states the numbers it is asserting on. */
async function seedRun(opts: {
  sourceType: 'artist' | 'category' | 'era';
  sourceId: string;
  label: string;
  date: string;
  songsCorrect: number;
  totalRounds?: number;
}) {
  const [challenge] = await db
    .insert(artistChallenges)
    .values({
      deezerArtistId: opts.sourceId,
      artistName: opts.label,
      challengeDate: opts.date,
      sourceType: opts.sourceType,
      totalRounds: opts.totalRounds ?? 10,
    })
    .returning();

  await db.insert(artistSessionResults).values({
    challengeId: challenge!.id,
    guestId: guest.guestId,
    completed: true,
    currentRound: 9,
    songsCorrect: opts.songsCorrect,
    totalGuessesUsed: 12,
    timeTakenSeconds: 70,
  });
}

beforeEach(async () => {
  await db.delete(gameResults);
  await db.delete(userStats);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
  await db.delete(survivalRuns);
  await db.delete(artistSessionResults);
  await db.delete(artistChallenges);
  await db.delete(users);
});

describe('xpForLevel', () => {
  it('starts level one at zero', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(0)).toBe(0);
  });

  it('rises, and each level costs more than the one before', () => {
    const gaps = [2, 3, 4, 5, 6].map((n) => xpForLevel(n) - xpForLevel(n - 1));
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
    }
  });

  /** Quadratic, not exponential: later levels should stay reachable for a casual player. */
  it('keeps late levels within reach rather than exploding', () => {
    expect(xpForLevel(20) / xpForLevel(10)).toBeLessThan(5);
  });
});

describe('levelForXp', () => {
  it('is level one with nothing played', () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, xp: 0, progress: 0 });
  });

  it('never reports a level whose threshold has not been met', () => {
    for (const xp of [0, 1, 99, 100, 101, 299, 300, 5000, 50000]) {
      const result = levelForXp(xp);
      expect(xpForLevel(result.level)).toBeLessThanOrEqual(xp);
      expect(xpForLevel(result.level + 1)).toBeGreaterThan(xp);
    }
  });

  it('reports progress through the current level between zero and one', () => {
    for (const xp of [0, 55, 140, 999, 4321]) {
      const { progress } = levelForXp(xp);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
  });

  it('treats a negative or fractional total as the whole number below it', () => {
    expect(levelForXp(-50).level).toBe(1);
    expect(levelForXp(120.9).xp).toBe(120);
  });
});

describe('getProgress', () => {
  it('is empty and level one for someone who has played nothing', async () => {
    const progress = await getProgress(guest);

    expect(progress.level.level).toBe(1);
    expect(progress.level.xp).toBe(0);
    expect(progress.mastery).toEqual([]);
    expect(progress.byMode.artist.runs).toBe(0);
  });

  it('counts songs named across modes into XP', async () => {
    await seedRun({
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
      date: 'p1',
      songsCorrect: 8,
    });
    await seedRun({
      sourceType: 'category',
      sourceId: 'year-2020',
      label: 'Top Hits 2020',
      date: 'p2',
      songsCorrect: 5,
    });

    const progress = await getProgress(guest);

    // 13 songs at 10 XP each, and nothing else played.
    expect(progress.sources.songs).toBe(130);
    expect(progress.level.xp).toBe(130);
  });

  it('adds up repeat runs of the same artist rather than listing them twice', async () => {
    await seedRun({
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
      date: 'q1',
      songsCorrect: 6,
    });
    await seedRun({
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
      date: 'q2',
      songsCorrect: 9,
    });

    const progress = await getProgress(guest);

    expect(progress.mastery).toHaveLength(1);
    expect(progress.mastery[0]).toMatchObject({
      label: 'Queen',
      runs: 2,
      songsCorrect: 15,
      songsPossible: 20,
      accuracy: 75,
      bestRun: 9,
    });
  });

  it('ranks mastery by songs named, which is what "you know this artist" means', async () => {
    await seedRun({
      sourceType: 'artist',
      sourceId: '1',
      label: 'Few',
      date: 'm1',
      songsCorrect: 3,
    });
    await seedRun({
      sourceType: 'artist',
      sourceId: '2',
      label: 'Many',
      date: 'm2',
      songsCorrect: 9,
    });

    const progress = await getProgress(guest);
    expect(progress.mastery.map((m) => m.label)).toEqual(['Many', 'Few']);
  });

  it('splits category runs by what kind of category they were', async () => {
    await seedRun({
      sourceType: 'category',
      sourceId: 'year-2020',
      label: 'Top Hits 2020',
      date: 'c1',
      songsCorrect: 7,
    });
    await seedRun({
      sourceType: 'category',
      sourceId: 'genre-pop-2024',
      label: 'Top Pop 2024',
      date: 'c2',
      songsCorrect: 4,
    });

    const progress = await getProgress(guest);

    expect(progress.byCategoryGroup.year).toMatchObject({ songsCorrect: 7, accuracy: 70 });
    expect(progress.byCategoryGroup.genre).toMatchObject({ songsCorrect: 4, accuracy: 40 });
  });

  /** Era is one global pool, so there is no artist or category to be a fan of. */
  it('keeps Era out of mastery while still counting its XP', async () => {
    await seedRun({
      sourceType: 'era',
      sourceId: 'era',
      label: 'Guess the Year',
      date: 'e1',
      songsCorrect: 6,
    });

    const progress = await getProgress(guest);

    expect(progress.mastery).toEqual([]);
    expect(progress.byMode.era.songsCorrect).toBe(6);
    expect(progress.sources.songs).toBe(60);
  });

  it('counts survival songs survived', async () => {
    await db.insert(survivalRuns).values([
      { guestId: guest.guestId, streak: 12, endedAt: new Date() },
      { guestId: guest.guestId, streak: 5, endedAt: new Date() },
      // Still in progress, so not yet part of anyone's record.
      { guestId: guest.guestId, streak: 3, endedAt: null },
    ]);

    const progress = await getProgress(guest);

    expect(progress.survival).toMatchObject({ runs: 2, bestStreak: 12, totalSongs: 17 });
    expect(progress.sources.survival).toBe(170);
  });

  it('counts daily wins, which are worth more than one song', async () => {
    // recordGameResult is what the daily route actually calls once a day's songs are all
    // finished — it's the source of truth for progress.daily, not a raw game_results count.
    await recordGameResult({
      ownerKey: guest.guestId,
      puzzleDate: '2030-01-01',
      slots: [{ won: true, guessesUsed: 2 }],
    });

    const progress = await getProgress(guest);

    expect(progress.daily).toMatchObject({ played: 1, won: 1 });
    expect(progress.sources.dailyWins).toBe(25);
  });

  it('counts a multi-song day as one day played, not one per song', async () => {
    // Regression guard: Daily mode now writes up to five game_results rows for a single day
    // (one per song). progress.daily must still read "days played" off user_stats, which
    // recordGameResult updates once per day — not derive it from a raw game_results count,
    // which would silently read this as 5 days and inflate the daily-XP total 5x.
    const [song] = await db
      .insert(songs)
      .values({
        title: 'S',
        artist: 'A',
        deezerTrackId: 'prog-multi',
        previewUrl: 'x',
        durationSeconds: 200,
      })
      .returning();
    const puzzles = await db
      .insert(dailyPuzzles)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          puzzleDate: '2030-02-01',
          position: i + 1,
          songId: song!.id,
        })),
      )
      .returning();
    await db.insert(gameResults).values(
      puzzles.map((p) => ({
        guestId: guest.guestId,
        puzzleId: p.id,
        won: true,
        guessesUsed: 2,
        snippetStageReached: 2,
      })),
    );

    const progress = await getProgress(guest);

    // No recordGameResult call was made, so user_stats has nothing for this owner yet.
    expect(progress.daily).toMatchObject({ played: 0, won: 0 });
    expect(progress.sources.dailyWins).toBe(0);
  });

  it('counts only this player, not everyone', async () => {
    await seedRun({
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
      date: 'x1',
      songsCorrect: 9,
    });

    const other = await getProgress({ userId: null, guestId: 'somebody-else' });
    expect(other.level.xp).toBe(0);
    expect(other.mastery).toEqual([]);
  });
});
