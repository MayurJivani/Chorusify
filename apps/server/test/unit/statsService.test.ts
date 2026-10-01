import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db/client';
import { userStats, gameResults, dailyPuzzles, songs, users } from '../../src/db/schema';
import {
  recordGameResult,
  getStats,
  getSolveTimeStats,
  mergeGuestStatsIntoUser,
} from '../../src/services/statsService';

beforeEach(async () => {
  await db.delete(gameResults);
  await db.delete(userStats);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
  await db.delete(users);
});

// Five-slot day results built from a terse win/loss pattern, e.g. 'wwlll'.
function dayOf(pattern: string): { won: boolean; guessesUsed: number }[] {
  return [...pattern].map((c) => ({ won: c === 'w', guessesUsed: c === 'w' ? 3 : 6 }));
}

describe('recordGameResult', () => {
  it('starts a streak of 1 on completing a first day, regardless of score', async () => {
    await recordGameResult({
      ownerKey: 'guest-1',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwll'),
    });

    const stats = await getStats('guest-1');
    expect(stats?.currentStreak).toBe(1);
    expect(stats?.maxStreak).toBe(1);
    expect(stats?.gamesPlayed).toBe(1);
    expect(stats?.gamesWon).toBe(1); // >=1 correct
    expect(stats?.perfectDays).toBe(0); // not all 5
    expect(stats?.guessDist3).toBe(3); // one bump per correct slot
  });

  it('continues the streak on a day with zero correct guesses, as long as it was completed', async () => {
    await recordGameResult({
      ownerKey: 'guest-2',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwww'),
    });
    await recordGameResult({
      ownerKey: 'guest-2',
      puzzleDate: '2026-01-02',
      slots: dayOf('lllll'),
    });

    const stats = await getStats('guest-2');
    expect(stats?.currentStreak).toBe(2);
    expect(stats?.maxStreak).toBe(2);
    expect(stats?.gamesWon).toBe(1); // only the first day had a correct guess
    expect(stats?.perfectDays).toBe(1);
  });

  it('marks a perfect day only when every slot is correct', async () => {
    await recordGameResult({
      ownerKey: 'guest-3',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwww'),
    });

    const stats = await getStats('guest-3');
    expect(stats?.gamesWon).toBe(1);
    expect(stats?.perfectDays).toBe(1);
  });

  it('resets the streak to 1 (not continues) when a day was skipped entirely', async () => {
    await recordGameResult({
      ownerKey: 'guest-4',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwww'),
    });
    await recordGameResult({
      ownerKey: 'guest-4',
      puzzleDate: '2026-01-05',
      slots: dayOf('wwwww'),
    });

    const stats = await getStats('guest-4');
    expect(stats?.currentStreak).toBe(1);
    expect(stats?.maxStreak).toBe(1);
  });

  it('is a no-op on a second call for a date already recorded, rather than double-counting', async () => {
    // Simulates a deploy that adds more songs to a day someone already finished under the old
    // single-song puzzle: recordGameResult fires once pre-deploy, then again post-deploy for
    // the same date once the newly-added songs are finished too.
    await recordGameResult({
      ownerKey: 'guest-6',
      puzzleDate: '2026-01-01',
      slots: dayOf('w'),
    });
    await recordGameResult({
      ownerKey: 'guest-6',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwww'),
    });

    const stats = await getStats('guest-6');
    expect(stats?.gamesPlayed).toBe(1);
    expect(stats?.currentStreak).toBe(1);
  });

  it('keeps max streak after it is broken by a skipped day', async () => {
    await recordGameResult({
      ownerKey: 'guest-5',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwww'),
    });
    await recordGameResult({
      ownerKey: 'guest-5',
      puzzleDate: '2026-01-02',
      slots: dayOf('wwwww'),
    });
    await recordGameResult({
      ownerKey: 'guest-5',
      puzzleDate: '2026-01-10',
      slots: dayOf('wwwww'),
    });

    const stats = await getStats('guest-5');
    expect(stats?.currentStreak).toBe(1);
    expect(stats?.maxStreak).toBe(2);
  });
});

describe('getStats', () => {
  it('returns null for an identity with no history', async () => {
    expect(await getStats('nobody')).toBeNull();
  });
});

describe('mergeGuestStatsIntoUser', () => {
  it('moves a guest stats row onto the new user and updates game_results ownership', async () => {
    const [song] = await db
      .insert(songs)
      .values({
        title: 'Song',
        artist: 'Artist',
        deezerTrackId: 'track-x',
        previewUrl: 'https://example.test/preview.mp3',
        durationSeconds: 180,
      })
      .returning();
    const [puzzle] = await db
      .insert(dailyPuzzles)
      .values({ puzzleDate: '2026-01-01', songId: song!.id })
      .returning();
    await db.insert(users).values({
      id: 'user-5',
      email: 'merge-test@example.com',
      passwordHash: 'x',
      displayName: 'Merge Test',
    });

    await recordGameResult({
      ownerKey: 'merge-guest',
      puzzleDate: '2026-01-01',
      slots: dayOf('wwwww'),
    });
    await db.insert(gameResults).values({
      userId: null,
      guestId: 'merge-guest',
      puzzleId: puzzle!.id,
      won: true,
      guessesUsed: 2,
      snippetStageReached: 1,
    });

    await mergeGuestStatsIntoUser('merge-guest', 'user-5');

    expect(await getStats('merge-guest')).toBeNull();
    expect((await getStats('user-5'))?.gamesWon).toBe(1);

    const results = await db.select().from(gameResults);
    expect(results[0]?.userId).toBe('user-5');
  });

  it('does nothing when the guest has no stats to merge', async () => {
    await expect(mergeGuestStatsIntoUser('no-guest', 'user-6')).resolves.toBeUndefined();
    expect(await getStats('user-6')).toBeNull();
  });
});

describe('getSolveTimeStats', () => {
  const ownerKey = 'guest-timing';

  async function seedPuzzleAndResult(opts: {
    n: number;
    won: boolean;
    guessesUsed: number;
    snippetStageReached: number;
    timeTakenSeconds: number | null;
  }) {
    const [song] = await db
      .insert(songs)
      .values({
        title: `Timed ${opts.n}`,
        artist: `Artist ${opts.n}`,
        deezerTrackId: `timed-${opts.n}`,
        previewUrl: `https://example.test/${opts.n}.mp3`,
        durationSeconds: 180,
      })
      .returning();
    const [puzzle] = await db
      .insert(dailyPuzzles)
      .values({ puzzleDate: `2026-07-${String(opts.n).padStart(2, '0')}`, songId: song!.id })
      .returning();
    await db.insert(gameResults).values({
      guestId: ownerKey,
      puzzleId: puzzle!.id,
      won: opts.won,
      guessesUsed: opts.guessesUsed,
      snippetStageReached: opts.snippetStageReached,
      timeTakenSeconds: opts.timeTakenSeconds,
    });
  }

  it('reports averages, extrema and totals as numbers', async () => {
    await seedPuzzleAndResult({
      n: 1,
      won: true,
      guessesUsed: 2,
      snippetStageReached: 1,
      timeTakenSeconds: 20,
    });
    await seedPuzzleAndResult({
      n: 2,
      won: true,
      guessesUsed: 4,
      snippetStageReached: 3,
      timeTakenSeconds: 40,
    });
    await seedPuzzleAndResult({
      n: 3,
      won: false,
      guessesUsed: 6,
      snippetStageReached: 5,
      timeTakenSeconds: 90,
    });

    const stats = await getSolveTimeStats(ownerKey);

    // AVG returns Postgres numeric, which arrives as a string — these must be parsed numbers.
    expect(typeof stats.averageSolveSeconds).toBe('number');
    expect(stats.averageSolveSeconds).toBe(30); // (20 + 40) / 2, losses excluded
    expect(stats.fastestSolveSeconds).toBe(20);
    expect(stats.slowestSolveSeconds).toBe(40);
    expect(stats.totalPlaySeconds).toBe(150); // includes the loss
    expect(stats.timedWins).toBe(2);
    expect(stats.averageGuessesPerWin).toBe(3); // (2 + 4) / 2
  });

  it('excludes results with no recorded time from the averages', async () => {
    await seedPuzzleAndResult({
      n: 4,
      won: true,
      guessesUsed: 1,
      snippetStageReached: 0,
      timeTakenSeconds: null,
    });
    await seedPuzzleAndResult({
      n: 5,
      won: true,
      guessesUsed: 3,
      snippetStageReached: 2,
      timeTakenSeconds: 60,
    });

    const stats = await getSolveTimeStats(ownerKey);

    expect(stats.averageSolveSeconds).toBe(60);
    expect(stats.timedWins).toBe(1);
    // Guess averages still cover every win, timed or not.
    expect(stats.averageGuessesPerWin).toBe(2);
  });

  it('returns nulls rather than NaN for a player with no history', async () => {
    const stats = await getSolveTimeStats('nobody-at-all');

    expect(stats.averageSolveSeconds).toBeNull();
    expect(stats.fastestSolveSeconds).toBeNull();
    expect(stats.averageGuessesPerWin).toBeNull();
    expect(stats.totalPlaySeconds).toBe(0);
    expect(stats.timedWins).toBe(0);
  });
});
