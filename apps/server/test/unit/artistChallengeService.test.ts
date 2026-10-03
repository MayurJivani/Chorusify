import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  artistChallenges,
  artistChallengeTracks,
  artistSessionResults,
  artistRoundGuesses,
  users,
} from '../../src/db/schema';
import * as deezerService from '../../src/services/deezerService';
import { clearArtistPools } from '../../src/services/artistCatalogService';
import { appSettings } from '../../src/db/schema';
import { invalidateSettingsCache, updateSettings } from '../../src/services/settingsService';

vi.mock('../../src/services/deezerService', () => ({
  getArtistById: vi.fn(),
  getArtistTopTracks: vi.fn(),
  getFreshPreviewUrl: vi.fn(),
  // Not exercised here, but artistCatalogService kicks it off in the background whenever it
  // fills a pool. It has to resolve to an array: the fire-and-forget caller chains .then on
  // the result, so a bare vi.fn() returning undefined throws inside every challenge test.
  fetchFullDiscography: vi.fn().mockResolvedValue([]),
}));

// Imported after the mock so the module under test picks up the mocked deezerService.
import {
  getOrCreateArtistChallenge,
  getOrCreateSessionProgress,
  recordArtistRoundResult,
  buildRoundOptions,
  getArtistLeaderboard,
  getArtistGuessDistribution,
  getChallengeSummary,
  evictAbandonedChallenges,
  resolvePlayableRound,
  loadChallengeTracks,
  getActiveSessionOrStartNew,
  ARTIST_CHALLENGE_SIZE,
} from '../../src/services/artistChallengeService';

function mockTracks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    deezerTrackId: `dz-${i}`,
    title: `Track ${i}`,
    artist: 'Queen',
    albumArtUrl: null,
    durationSeconds: 200,
  }));
}

beforeEach(async () => {
  // The artist catalog is cached in Postgres, so it must be cleared too — otherwise a stored
  // pool would satisfy the lookup and the per-test deezerService mock would never be called.
  await clearArtistPools();
  await db.delete(artistRoundGuesses);
  await db.delete(artistSessionResults);
  await db.delete(artistChallengeTracks);
  await db.delete(artistChallenges);
  await db.delete(users);
  // Run length is a setting, so a value left by one test would silently change the next one's
  // expected number of rounds.
  await db.delete(appSettings);
  invalidateSettingsCache();
  vi.clearAllMocks();
  vi.mocked(deezerService.getArtistById).mockResolvedValue({
    id: 412,
    name: 'Queen',
    pictureUrl: null,
  });
  vi.mocked(deezerService.getArtistTopTracks).mockResolvedValue(mockTracks(20));
  vi.mocked(deezerService.getFreshPreviewUrl).mockResolvedValue({
    previewUrl: 'https://example.test/preview.mp3',
    durationSeconds: 200,
  });
});

describe('getOrCreateArtistChallenge', () => {
  it('creates a challenge with exactly ARTIST_CHALLENGE_SIZE tracks', async () => {
    const { challenge, tracks } = await getOrCreateArtistChallenge(412, '2026-01-01');
    expect(challenge.artistName).toBe('Queen');
    expect(tracks).toHaveLength(ARTIST_CHALLENGE_SIZE);
    expect(new Set(tracks.map((t) => t.deezerTrackId)).size).toBe(ARTIST_CHALLENGE_SIZE);
  });

  it('is deterministic and idempotent for the same artist+date', async () => {
    const first = await getOrCreateArtistChallenge(412, '2026-01-01');
    const second = await getOrCreateArtistChallenge(412, '2026-01-01');

    expect(second.challenge.id).toBe(first.challenge.id);
    expect(second.tracks.map((t) => t.deezerTrackId)).toEqual(
      first.tracks.map((t) => t.deezerTrackId),
    );
    // Second call should not need to hit Deezer again since the challenge already exists.
    expect(deezerService.getArtistTopTracks).toHaveBeenCalledTimes(1);
  });

  it('produces different track sets for different dates', async () => {
    const day1 = await getOrCreateArtistChallenge(412, '2026-01-01');
    const day2 = await getOrCreateArtistChallenge(412, '2026-01-02');

    expect(day2.tracks.map((t) => t.deezerTrackId)).not.toEqual(
      day1.tracks.map((t) => t.deezerTrackId),
    );
  });

  /*
   * A thin catalogue plays short rather than not at all — K/DA and similar have a handful of
   * tracks, and refusing them read as a bug rather than "this artist has six songs". These used
   * to assert the old refuse-everything rule and had been failing since the behaviour changed.
   */
  it('plays a short run when the artist has fewer tracks than the run length', async () => {
    vi.mocked(deezerService.getArtistTopTracks).mockResolvedValue(mockTracks(3));

    const { challenge, tracks } = await getOrCreateArtistChallenge(412, '2026-01-01');

    expect(tracks).toHaveLength(3);
    expect(challenge.totalRounds).toBe(3);
  });

  it('excludes a short run from ranking, so it is not a comparable score', async () => {
    vi.mocked(deezerService.getArtistTopTracks).mockResolvedValue(mockTracks(3));

    const { challenge } = await getOrCreateArtistChallenge(412, '2026-01-02');

    expect(challenge.ranked).toBe(false);
  });

  it('still ranks a run that reaches the full configured length', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-01-03');
    expect(challenge.ranked).toBe(true);
  });

  it('refuses an artist too thin to make a game at all', async () => {
    // Below MIN_PLAYABLE_ROUNDS a "run" is a coin toss, not a game, so this still throws.
    vi.mocked(deezerService.getArtistTopTracks).mockResolvedValue(mockTracks(2));
    await expect(getOrCreateArtistChallenge(412, '2026-01-04')).rejects.toThrow(/not enough/i);
  });

  it('throws when the artist cannot be found', async () => {
    vi.mocked(deezerService.getArtistById).mockResolvedValue(null);
    await expect(getOrCreateArtistChallenge(999, '2026-01-01')).rejects.toThrow(/not found/i);
  });

  it('treats includeFeatures as part of the challenge identity — two independent challenges', async () => {
    const withoutFeatures = await getOrCreateArtistChallenge(412, '2026-01-01', false);
    const withFeatures = await getOrCreateArtistChallenge(412, '2026-01-01', true);

    expect(withFeatures.challenge.id).not.toBe(withoutFeatures.challenge.id);
    expect(deezerService.getArtistTopTracks).toHaveBeenCalledWith(412, false);
    expect(deezerService.getArtistTopTracks).toHaveBeenCalledWith(412, true);
  });
});

/**
 * The resume rule, which is anti-cheat rather than convenience.
 *
 * If walking away and coming back dealt a new hand, a player stuck on a hard song could reroll
 * until the draw was easy and every leaderboard entry would be the best of N attempts. These
 * cover both directions of the rule; before this the behaviour had no coverage at all.
 */
describe('resuming an unfinished run', () => {
  const guest = { userId: null, guestId: 'resume-guest' };

  it('hands back the same challenge mid-run, so the draw cannot be rerolled', async () => {
    const first = await getActiveSessionOrStartNew(412, false, guest);
    await recordArtistRoundResult(first.session.id, false, 1, 1);

    const second = await getActiveSessionOrStartNew(412, false, guest);

    expect(second.challenge.id).toBe(first.challenge.id);
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.completed).toBe(false);
    // The same songs, in the same order — a reroll would show up here first.
    expect(second.tracks.map((t) => t.deezerTrackId)).toEqual(
      first.tracks.map((t) => t.deezerTrackId),
    );
  });

  it('resumes at the round the player left off on', async () => {
    const started = await getActiveSessionOrStartNew(412, false, {
      userId: null,
      guestId: 'resume-guest-2',
    });
    await recordArtistRoundResult(started.session.id, true, 1, 1);
    await recordArtistRoundResult(started.session.id, true, 1, 1);

    const resumed = await getActiveSessionOrStartNew(412, false, {
      userId: null,
      guestId: 'resume-guest-2',
    });

    expect(resumed.session.currentRound).toBe(2);
    expect(resumed.session.songsCorrect).toBe(2);
  });

  it('deals a fresh challenge once the run is finished', async () => {
    const identity = { userId: null, guestId: 'finished-guest' };
    const played = await getActiveSessionOrStartNew(412, false, identity);
    for (let round = 0; round < ARTIST_CHALLENGE_SIZE; round += 1) {
      await recordArtistRoundResult(played.session.id, true, 1, 1);
    }

    const next = await getActiveSessionOrStartNew(412, false, identity);

    // Finishing banks the score, so there is nothing left to reroll — a new run here is what
    // stops the player being stranded on their old results screen.
    expect(next.challenge.id).not.toBe(played.challenge.id);
    expect(next.session.completed).toBe(false);
    expect(next.session.currentRound).toBe(0);
  });

  it('keeps an explicit play-again separate from the run it replaces', async () => {
    const identity = { userId: null, guestId: 'play-again-guest' };
    const first = await getActiveSessionOrStartNew(412, false, identity);

    const replayed = await getActiveSessionOrStartNew(412, false, identity, true);

    expect(replayed.challenge.id).not.toBe(first.challenge.id);
  });
});

describe('getOrCreateSessionProgress + recordArtistRoundResult', () => {
  it('starts a guest session at round 0 and progresses correctly', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-01-01');
    const session = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'guest-1',
    });

    expect(session.currentRound).toBe(0);
    expect(session.completed).toBe(false);

    const same = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'guest-1',
    });
    expect(same.id).toBe(session.id);

    const result = await recordArtistRoundResult(session.id, true, 2, 2);
    expect(result.sessionComplete).toBe(false);
    expect(result.songsCorrect).toBe(1);
    expect(result.totalGuessesUsed).toBe(2);
  });

  it('marks the session complete after the final round', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-01-01');
    const session = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'guest-2',
    });

    let lastResult = await recordArtistRoundResult(session.id, true, 1, 1);
    for (let round = 1; round < ARTIST_CHALLENGE_SIZE; round += 1) {
      lastResult = await recordArtistRoundResult(session.id, round % 2 === 0, 3, 4);
    }

    expect(lastResult.sessionComplete).toBe(true);
  });
});

describe('buildRoundOptions', () => {
  const correct = {
    deezerTrackId: 'dz-correct',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    albumArtUrl: null,
    durationSeconds: 200,
  };
  const pool = [
    correct,
    {
      deezerTrackId: 'dz-1',
      title: 'Under Pressure',
      artist: 'Queen',
      albumArtUrl: null,
      durationSeconds: 200,
    },
    {
      deezerTrackId: 'dz-2',
      title: "Don't Stop Me Now",
      artist: 'Queen',
      albumArtUrl: null,
      durationSeconds: 200,
    },
    {
      deezerTrackId: 'dz-3',
      title: 'We Will Rock You',
      artist: 'Queen',
      albumArtUrl: null,
      durationSeconds: 200,
    },
  ];

  it('always includes the correct track among three options', () => {
    const options = buildRoundOptions(correct, pool);
    expect(options).toHaveLength(3);
    expect(options.some((o) => o.deezerTrackId === correct.deezerTrackId)).toBe(true);
    expect(new Set(options.map((o) => o.deezerTrackId)).size).toBe(3);
  });

  it('never picks a decoy that normalizes to the same title as the correct answer', () => {
    const poolWithDuplicateTitle = [
      correct,
      // A different track id but the same song under a slightly different title casing/punctuation.
      {
        deezerTrackId: 'dz-dup',
        title: 'bohemian rhapsody!',
        artist: 'Queen',
        albumArtUrl: null,
        durationSeconds: 200,
      },
      {
        deezerTrackId: 'dz-1',
        title: 'Under Pressure',
        artist: 'Queen',
        albumArtUrl: null,
        durationSeconds: 200,
      },
      {
        deezerTrackId: 'dz-2',
        title: "Don't Stop Me Now",
        artist: 'Queen',
        albumArtUrl: null,
        durationSeconds: 200,
      },
    ];

    for (let i = 0; i < 20; i += 1) {
      const options = buildRoundOptions(correct, poolWithDuplicateTitle);
      expect(options.some((o) => o.deezerTrackId === 'dz-dup')).toBe(false);
    }
  });

  it('draws decoys from the wider pool, not just a fixed set of 9', () => {
    const bigPool = [
      correct,
      ...Array.from({ length: 40 }, (_, i) => ({
        deezerTrackId: `dz-wide-${i}`,
        title: `Wide Track ${i}`,
        artist: 'Queen',
        albumArtUrl: null,
        durationSeconds: 200,
      })),
    ];

    const seenDecoyIds = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      const options = buildRoundOptions(correct, bigPool);
      options
        .filter((o) => o.deezerTrackId !== correct.deezerTrackId)
        .forEach((o) => seenDecoyIds.add(o.deezerTrackId));
    }

    expect(seenDecoyIds.size).toBeGreaterThan(2);
  });

  it('keeps decoys within the answer’s own category when the pool is a merge of several', () => {
    const mergedPool = [
      { ...correct, categoryId: 'year-2020' },
      { ...pool[1]!, categoryId: 'year-2020' },
      { ...pool[2]!, categoryId: 'year-2020' },
      {
        deezerTrackId: 'dz-hindi-1',
        title: 'Tum Hi Ho',
        artist: 'Arijit Singh',
        albumArtUrl: null,
        durationSeconds: 200,
        categoryId: 'bollywood-romance',
      },
      {
        deezerTrackId: 'dz-hindi-2',
        title: 'Kesariya',
        artist: 'Arijit Singh',
        albumArtUrl: null,
        durationSeconds: 200,
        categoryId: 'bollywood-romance',
      },
    ];

    for (let i = 0; i < 20; i += 1) {
      const options = buildRoundOptions(correct, mergedPool);
      const decoyIds = options
        .filter((o) => o.deezerTrackId !== correct.deezerTrackId)
        .map((o) => o.deezerTrackId);
      expect(decoyIds).not.toContain('dz-hindi-1');
      expect(decoyIds).not.toContain('dz-hindi-2');
    }
  });

  it('falls back to the whole pool when the answer’s own category can’t fill every decoy', () => {
    const mergedPool = [
      { ...correct, categoryId: 'year-2020' }, // the only year-2020 track
      {
        deezerTrackId: 'dz-hindi-1',
        title: 'Tum Hi Ho',
        artist: 'Arijit Singh',
        albumArtUrl: null,
        durationSeconds: 200,
        categoryId: 'bollywood-romance',
      },
      {
        deezerTrackId: 'dz-hindi-2',
        title: 'Kesariya',
        artist: 'Arijit Singh',
        albumArtUrl: null,
        durationSeconds: 200,
        categoryId: 'bollywood-romance',
      },
    ];

    const options = buildRoundOptions(correct, mergedPool, 3);
    expect(options).toHaveLength(3);
  });

  it('leaves untagged pools unchanged: a single-category/artist pool mixes freely', () => {
    const options = buildRoundOptions(correct, pool); // `pool` has no categoryId on any track
    expect(options).toHaveLength(3);
  });
});

/** Fixtures that need a real account, since boards only list registered users. */
async function seedUser(id: string, displayName: string) {
  await db
    .insert(users)
    .values({ id, email: `${id}@example.test`, passwordHash: 'x', displayName });
}

describe('getArtistLeaderboard', () => {
  /** Plays a whole run to completion for one player, at a fixed guess cost per round. */
  async function playRun(
    challengeId: number,
    identity: { userId: string | null; guestId: string | null },
    opts: { correctRounds: number; guessesPerRound: number; timeTakenSeconds: number },
  ) {
    const session = await getOrCreateSessionProgress(challengeId, identity);
    for (let i = 0; i < ARTIST_CHALLENGE_SIZE; i += 1) {
      await recordArtistRoundResult(
        session.id,
        i < opts.correctRounds,
        opts.guessesPerRound,
        opts.guessesPerRound,
      );
    }
    // Wall-clock timing is not deterministic enough to order fixtures by, so pin it.
    await db
      .update(artistSessionResults)
      .set({ timeTakenSeconds: opts.timeTakenSeconds })
      .where(eq(artistSessionResults.id, session.id));
    return session;
  }

  it('ranks by total songs correct, so playing more counts', async () => {
    await seedUser('user-a', 'Ada');
    await seedUser('user-b', 'Grace');

    // Grace has the single best run (10/10) but only one of them.
    const first = await getOrCreateArtistChallenge(412, 'lb-1');
    await playRun(
      first.challenge.id,
      { userId: 'user-b', guestId: null },
      {
        correctRounds: 10,
        guessesPerRound: 1,
        timeTakenSeconds: 10,
      },
    );

    // Ada never matches it, but two solid runs total more songs named.
    for (const date of ['lb-2', 'lb-3']) {
      const { challenge } = await getOrCreateArtistChallenge(412, date);
      await playRun(
        challenge.id,
        { userId: 'user-a', guestId: null },
        {
          correctRounds: 7,
          guessesPerRound: 2,
          timeTakenSeconds: 30,
        },
      );
    }

    const { entries } = await getArtistLeaderboard(412, { userId: 'user-a', guestId: null });

    // The regression this guards: best-of ranking put Grace first for one lucky draw, which is
    // exactly what made replaying until you drew an easy set the winning strategy.
    expect(entries[0]?.displayName).toBe('Ada');
    expect(entries[0]).toMatchObject({ songsCorrect: 14, runs: 2, bestRun: 7, isYou: true });
    expect(entries[1]).toMatchObject({ displayName: 'Grace', songsCorrect: 10, runs: 1 });
  });

  it('reports accuracy against the rounds actually played', async () => {
    await seedUser('user-a', 'Ada');
    const { challenge } = await getOrCreateArtistChallenge(412, 'lb-acc');
    await playRun(
      challenge.id,
      { userId: 'user-a', guestId: null },
      {
        correctRounds: 6,
        guessesPerRound: 1,
        timeTakenSeconds: 40,
      },
    );

    const { entries } = await getArtistLeaderboard(412, { userId: 'user-a', guestId: null });
    expect(entries[0]).toMatchObject({ songsCorrect: 6, songsPossible: 10, accuracy: 60 });
  });

  it('breaks ties on total guesses, then average time', async () => {
    await seedUser('user-a', 'Ada');
    await seedUser('user-b', 'Grace');

    const a = await getOrCreateArtistChallenge(412, 'tie-a');
    await playRun(
      a.challenge.id,
      { userId: 'user-a', guestId: null },
      {
        correctRounds: 10,
        guessesPerRound: 2,
        timeTakenSeconds: 20,
      },
    );
    const b = await getOrCreateArtistChallenge(412, 'tie-b');
    await playRun(
      b.challenge.id,
      { userId: 'user-b', guestId: null },
      {
        correctRounds: 10,
        guessesPerRound: 1,
        timeTakenSeconds: 90,
      },
    );

    const { entries } = await getArtistLeaderboard(412, { userId: null, guestId: 'nobody' });
    // Same total correct; Grace used fewer guesses, which outranks her slower time.
    expect(entries.map((e) => e.displayName)).toEqual(['Grace', 'Ada']);
  });

  it('gives a guest their own totals even though they are never ranked', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, 'lb-guest');
    await playRun(
      challenge.id,
      { userId: null, guestId: 'guest-solo' },
      {
        correctRounds: 8,
        guessesPerRound: 1,
        timeTakenSeconds: 45,
      },
    );

    const { entries, mine } = await getArtistLeaderboard(412, {
      userId: null,
      guestId: 'guest-solo',
    });

    expect(entries).toHaveLength(0);
    expect(mine).toMatchObject({
      runs: 1,
      songsCorrect: 8,
      songsPossible: 10,
      accuracy: 80,
      bestRun: 8,
      fastestRunSeconds: 45,
    });
  });

  it('returns no totals for someone who has never finished a run', async () => {
    const { mine } = await getArtistLeaderboard(412, { userId: null, guestId: 'never-played' });
    expect(mine).toBeNull();
  });

  it('only counts completed sessions', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-01-01');
    const session = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'guest-incomplete',
    });
    await recordArtistRoundResult(session.id, true, 1, 1); // only 1 of 10 rounds played

    const { entries } = await getArtistLeaderboard(412, {
      userId: null,
      guestId: 'someone-else',
    });
    expect(entries).toHaveLength(0);
  });
});

describe('resolvePlayableRound', () => {
  it('returns the stored track when its preview is playable', async () => {
    const { tracks } = await getOrCreateArtistChallenge(412, '2026-03-01');
    const first = tracks[0]!;

    const resolved = await resolvePlayableRound(first, 412, false, [first.deezerTrackId]);

    expect(resolved?.track.deezerTrackId).toBe(first.deezerTrackId);
    expect(resolved?.previewUrl).toBe('https://example.test/preview.mp3');
  });

  it('substitutes another catalog track when the stored one has no preview, and persists it', async () => {
    const { challenge, tracks } = await getOrCreateArtistChallenge(412, '2026-03-02');
    const dead = tracks[0]!;

    // Only the challenge's own track is unplayable; everything else in the catalog is fine.
    vi.mocked(deezerService.getFreshPreviewUrl).mockImplementation(async (trackId: string) =>
      trackId === dead.deezerTrackId
        ? null
        : { previewUrl: `https://example.test/${trackId}.mp3`, durationSeconds: 200 },
    );

    const resolved = await resolvePlayableRound(
      dead,
      412,
      false,
      tracks.map((t) => t.deezerTrackId),
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.track.deezerTrackId).not.toBe(dead.deezerTrackId);
    // The replacement must not duplicate a track already in the challenge.
    expect(tracks.map((t) => t.deezerTrackId)).not.toContain(resolved!.track.deezerTrackId);

    // The repair is written back, so the next player of this shared challenge sees the fix.
    const reloaded = await loadChallengeTracks(challenge.id);
    expect(reloaded[0]?.deezerTrackId).toBe(resolved!.track.deezerTrackId);
    expect(reloaded).toHaveLength(ARTIST_CHALLENGE_SIZE);
  });

  it('gives up and returns null when nothing in the catalog is playable', async () => {
    const { tracks } = await getOrCreateArtistChallenge(412, '2026-03-03');
    vi.mocked(deezerService.getFreshPreviewUrl).mockResolvedValue(null);

    const resolved = await resolvePlayableRound(
      tracks[0]!,
      412,
      false,
      tracks.map((t) => t.deezerTrackId),
    );

    expect(resolved).toBeNull();
  });
});

describe('getArtistGuessDistribution', () => {
  const identity = { userId: null, guestId: 'guest-dist' };

  async function completedSessionWithGuesses(stages: number[]) {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-04-01');
    const session = await getOrCreateSessionProgress(challenge.id, identity);
    await db
      .update(artistSessionResults)
      .set({ completed: true })
      .where(eq(artistSessionResults.id, session.id));

    await db.insert(artistRoundGuesses).values(
      stages.map((snippetStageSeconds, position) => ({
        sessionId: session.id,
        position,
        correct: true,
        snippetStageSeconds,
      })),
    );
  }

  it('returns counts as numbers, not the strings Postgres bigint yields', async () => {
    await completedSessionWithGuesses([1, 1, 4]);

    const buckets = await getArtistGuessDistribution(412, identity);

    // Asserting the runtime type explicitly: the row type is a hand-written assertion, so a
    // bigint coming back as "2" instead of 2 type-checks fine and only breaks in the browser.
    for (const bucket of buckets) {
      expect(typeof bucket.allPlayers).toBe('number');
      expect(typeof bucket.myGuesses).toBe('number');
    }

    // The exact failure this guards: summing buckets must add, not concatenate.
    const total = buckets.reduce((sum, b) => sum + b.allPlayers, 0);
    expect(total).toBe(3);
    expect(buckets.find((b) => b.snippetSeconds === 1)?.allPlayers).toBe(2);
    expect(buckets.find((b) => b.snippetSeconds === 4)?.allPlayers).toBe(1);
    expect(buckets.find((b) => b.snippetSeconds === 2)?.allPlayers).toBe(0);
  });

  it('reports zeroes for an artist with no completed guesses', async () => {
    const buckets = await getArtistGuessDistribution(999999, identity);
    expect(buckets).toHaveLength(6);
    expect(buckets.reduce((sum, b) => sum + b.allPlayers + b.myGuesses, 0)).toBe(0);
  });
});

describe('evictAbandonedChallenges', () => {
  const identity = { userId: null, guestId: 'guest-evict' };

  /** Backdates a challenge so it falls outside the retention window. */
  async function backdate(challengeId: number) {
    await db
      .update(artistChallenges)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(artistChallenges.id, challengeId));
  }

  it('removes an old challenge nobody played, along with its tracks and session', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-05-01');
    await getOrCreateSessionProgress(challenge.id, identity);
    await backdate(challenge.id);

    expect(await evictAbandonedChallenges()).toBe(1);

    expect(await db.select().from(artistChallenges)).toHaveLength(0);
    // Cascading foreign keys must take the dependent rows with it.
    expect(await loadChallengeTracks(challenge.id)).toHaveLength(0);
    expect(await db.select().from(artistSessionResults)).toHaveLength(0);
  });

  it('keeps an old challenge someone actually played a round of', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-05-02');
    const session = await getOrCreateSessionProgress(challenge.id, identity);
    await db
      .update(artistSessionResults)
      .set({ currentRound: 3 })
      .where(eq(artistSessionResults.id, session.id));
    await backdate(challenge.id);

    expect(await evictAbandonedChallenges()).toBe(0);
    expect(await db.select().from(artistChallenges)).toHaveLength(1);
  });

  it('keeps a completed challenge, so leaderboard standings survive', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-05-03');
    const session = await getOrCreateSessionProgress(challenge.id, identity);
    await db
      .update(artistSessionResults)
      .set({ completed: true, songsCorrect: 7 })
      .where(eq(artistSessionResults.id, session.id));
    await backdate(challenge.id);

    expect(await evictAbandonedChallenges()).toBe(0);
    expect(await db.select().from(artistChallenges)).toHaveLength(1);
  });

  it('keeps a freshly abandoned challenge, so a new shared link still resolves', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, '2026-05-04');
    await getOrCreateSessionProgress(challenge.id, identity);

    expect(await evictAbandonedChallenges()).toBe(0);
    expect(await db.select().from(artistChallenges)).toHaveLength(1);
  });
});

describe('configurable run length', () => {
  it('builds a challenge with as many rounds as the setting asks for', async () => {
    await updateSettings([{ key: 'challengeRounds', value: 15 }], null);

    const { challenge, tracks } = await getOrCreateArtistChallenge(412, 'rounds-15');

    expect(challenge.totalRounds).toBe(15);
    expect(tracks).toHaveLength(15);
    expect(new Set(tracks.map((t) => t.deezerTrackId)).size).toBe(15);
  });

  it('caps the run at the catalog size when the setting asks for more', async () => {
    vi.mocked(deezerService.getArtistTopTracks).mockResolvedValue(mockTracks(12));
    await updateSettings([{ key: 'challengeRounds', value: 20 }], null);

    const { challenge, tracks } = await getOrCreateArtistChallenge(412, 'rounds-20');

    expect(tracks).toHaveLength(12);
    expect(challenge.totalRounds).toBe(12);
    // Short of the configured 20, so it happens but does not count.
    expect(challenge.ranked).toBe(false);
  });

  /**
   * The regression this guards: the last round used to be decided by reading the *current*
   * setting. Shortening a run from 15 to 5 would then declare an in-flight 15-song challenge
   * finished at round 5 — and lengthening it would leave a 10-song challenge unable to ever
   * reach a round it has no track for.
   */
  it('finishes an in-flight challenge at its own length, not the new setting', async () => {
    await updateSettings([{ key: 'challengeRounds', value: 4 }], null);
    const { challenge } = await getOrCreateArtistChallenge(412, 'in-flight');
    const session = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'guest-rounds',
    });

    // The admin doubles the run length while this player is mid-run.
    await updateSettings([{ key: 'challengeRounds', value: 8 }], null);

    let result = await recordArtistRoundResult(session.id, true, 1, 1);
    for (let round = 1; round < 4; round += 1) {
      expect(result.sessionComplete).toBe(false);
      result = await recordArtistRoundResult(session.id, true, 1, 1);
    }

    expect(result.sessionComplete).toBe(true);
    expect(result.totalRounds).toBe(4);
    expect(result.songsCorrect).toBe(4);
  });
});

describe('getChallengeSummary', () => {
  it('reports the first finisher as the score to beat', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, 'duel-1');
    await seedUser('first', 'Ada');
    await seedUser('second', 'Grace');

    const ada = await getOrCreateSessionProgress(challenge.id, { userId: 'first', guestId: null });
    for (let i = 0; i < ARTIST_CHALLENGE_SIZE; i += 1) {
      await recordArtistRoundResult(ada.id, i < 7, 1, 1);
    }

    // Grace finishes later with a better score; the opponent must stay whoever sent the link.
    const grace = await getOrCreateSessionProgress(challenge.id, {
      userId: 'second',
      guestId: null,
    });
    for (let i = 0; i < ARTIST_CHALLENGE_SIZE; i += 1) {
      await recordArtistRoundResult(grace.id, true, 1, 1);
    }

    const summary = await getChallengeSummary(challenge.id);

    expect(summary?.challenger).toMatchObject({ displayName: 'Ada', songsCorrect: 7 });
    expect(summary?.totalRounds).toBe(ARTIST_CHALLENGE_SIZE);
    expect(summary?.label).toBe('Queen');
  });

  it('has no challenger until somebody finishes', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, 'duel-2');
    await getOrCreateSessionProgress(challenge.id, { userId: null, guestId: 'halfway' });

    const summary = await getChallengeSummary(challenge.id);
    expect(summary?.challenger).toBeNull();
  });

  it('counts a guest sender, who is identified by the link rather than an account', async () => {
    const { challenge } = await getOrCreateArtistChallenge(412, 'duel-3');
    const session = await getOrCreateSessionProgress(challenge.id, {
      userId: null,
      guestId: 'sender',
    });
    for (let i = 0; i < ARTIST_CHALLENGE_SIZE; i += 1) {
      await recordArtistRoundResult(session.id, i < 4, 1, 1);
    }

    const summary = await getChallengeSummary(challenge.id);
    expect(summary?.challenger).toMatchObject({ displayName: 'A friend', songsCorrect: 4 });
  });

  it('is null for a challenge that does not exist', async () => {
    expect(await getChallengeSummary(999999)).toBeNull();
  });
});
