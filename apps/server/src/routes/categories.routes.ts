/**
 * Category Mode — the same ten-round game as Artist Mode, drawn from an editorial playlist
 * ("Top Hits 2024") instead of one artist's discography.
 *
 * These routes mirror `artists.routes.ts` deliberately: everything below the route layer is the
 * shared challenge machinery, and the only real difference is that a category is identified by
 * a slug the server already knows, so there is nothing to search and nothing to validate beyond
 * "is this one of ours".
 */
import { Router } from 'express';
import { playersBySource } from '../services/multiplayerService';
import { getQueueCounts } from '../services/duelQueueService';
import { z } from 'zod';
import { CATEGORIES } from '../services/categories';
import { resolveCategorySource } from '../services/challengeSource';
import {
  recordArtistRoundResult,
  buildRoundOptions,
  getSourceLeaderboard,
  getSourceGuessDistribution,
  getChallengeLeaderboard,
  getActiveSessionForSource,
  getSessionOrStartNew,
  loadChallengeTracks,
  resolvePlayableRoundForSource,
} from '../services/artistChallengeService';
import { isFinalAttempt } from '../services/guessService';
import {
  getSnippetSchedule,
  snippetSecondsForGuess,
  MAX_GUESSES_LIMIT,
} from '../services/puzzleService';
import { getIdentity } from '../auth/identity';
import { validate } from '../middleware/validate';
import { searchRateLimiter, guessRateLimiter } from '../middleware/rateLimiters';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';

export const categoriesRouter = Router();

// A categoryId is either one slug or several joined with `+` (see CATEGORY_ID_SEPARATOR),
// so the pattern and length allow for a handful of combined categories, not just one.
const categoryIdParamsSchema = z.object({
  categoryId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9+-]+$/),
});
const challengeQuerySchema = z.object({
  playAgain: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  mode: z.enum(['search', 'choice']).optional(),
  challengeId: z.coerce.number().int().positive().optional(),
});
const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(80) });

/**
 * The catalog itself is a compile-time constant, so this needs no Deezer call and no cache.
 *
 * `playing` and `queued` come from in-memory room and queue state, so they cost nothing to
 * include and let the picker show where people actually are — a list of eighty equally
 * plausible categories is otherwise a guess about whether anyone else is there.
 */
categoriesRouter.get('/', (_req, res) => {
  const inRooms = playersBySource();
  const queued = getQueueCounts();

  res.json({
    /* Soundtrack collections appear here *and* at /api/soundtracks, on purpose. They are their own mode
       with its own page, but they are also a perfectly good thing to find while browsing the
       category list, and a player looking for something to play should not have to already
       know the mode exists. /api/soundtracks stays the richer listing (film counts, score/songs
       kind); this is the browse entry point.

       One consumer deliberately filters them back out: the multiplayer source picker, which
       has a separate Movie tab. Picking a collection from its Category tab would queue a duel
       on the category rating ladder rather than the movie one. */
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      group: c.group,
      blurb: c.blurb,
      playing: inRooms[`category:${c.id}`] ?? 0,
      queued: queued.find((q) => q.key === `category:${c.id}`)?.count ?? 0,
    })),
  });
});

/** Resolves the slug (or combined slugs), turning a bad one into a 404 rather than a 500. */
function sourceFor(categoryId: string) {
  try {
    return resolveCategorySource(categoryId);
  } catch (err) {
    throw new HttpError(404, err instanceof Error ? err.message : 'Unknown category');
  }
}

categoriesRouter.get(
  '/:categoryId/challenge/today',
  validate(categoryIdParamsSchema, 'params'),
  validate(challengeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params as unknown as z.infer<typeof categoryIdParamsSchema>;
    const { playAgain, mode, challengeId } = req.query as unknown as z.infer<
      typeof challengeQuerySchema
    >;

    const source = sourceFor(categoryId);
    const identity = getIdentity(req);
    // Same reason as multiplayer: you cannot search a song index for a film title.
    const effectiveMode = source.answerIsTitle ? 'choice' : mode;

    let session, challenge, tracks;
    try {
      const result = await getSessionOrStartNew(source, identity, playAgain, challengeId);
      session = result.session;
      challenge = result.challenge;
      tracks = result.tracks;
    } catch (err) {
      throw new HttpError(
        404,
        err instanceof Error ? err.message : 'Could not build a challenge for this category',
      );
    }

    const snippetSchedule = await getSnippetSchedule();
    const base = {
      challengeId: challenge.id,
      artistName: challenge.artistName,
      artistPictureUrl: null,
      totalRounds: challenge.totalRounds,
      currentRound: session.currentRound,
      songsCorrect: session.songsCorrect,
      totalGuessesUsed: session.totalGuessesUsed,
      completed: session.completed,
    };

    if (session.completed) {
      res.json(base);
      return;
    }

    const storedTrack = tracks[session.currentRound];
    if (!storedTrack) {
      throw new HttpError(500, 'Challenge round is out of range');
    }

    const playable = await resolvePlayableRoundForSource(
      storedTrack,
      source,
      tracks.map((t) => t.deezerTrackId),
    );
    if (!playable) {
      throw new HttpError(503, 'This song is temporarily unavailable, please try again shortly');
    }
    const currentTrack = playable.track;

    const options =
      effectiveMode === 'choice'
        ? buildRoundOptions(currentTrack, await source.loadCatalog(), 3, source.answerIsTitle)
        : undefined;

    res.json({
      ...base,
      previewUrl: playable.previewUrl,
      snippetSchedule,
      maxGuesses: snippetSchedule.length,
      ...(options !== undefined ? { options } : {}),
    });
  }),
);

categoriesRouter.get(
  '/:categoryId/tracks/search',
  searchRateLimiter,
  validate(categoryIdParamsSchema, 'params'),
  validate(searchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params as unknown as z.infer<typeof categoryIdParamsSchema>;
    const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;

    // Searches the whole category pool rather than today's ten tracks — narrowing suggestions
    // to the answer set would make guessing trivial. Artist is matched as well as title here
    // because in a category the artist is a genuine (and useful) way to find a song.
    const pool = await sourceFor(categoryId).loadCatalog();
    const needle = q.toLowerCase();
    const results = pool
      .filter(
        (t) => t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((t) => ({
        deezerTrackId: t.deezerTrackId,
        title: t.title,
        artist: t.artist,
        albumArtUrl: t.albumArtUrl,
      }));

    res.json({ results });
  }),
);

const guessSchema = z.object({
  // Omitted entirely for a "skip" — the attempt is spent without guessing a specific track.
  deezerTrackId: z.string().min(1).optional(),
  // Bounded by the largest schedule any setting allows, because a zod schema is built at
  // import time and cannot await the live one; the handler rejects anything over it.
  guessNumber: z.number().int().min(1).max(MAX_GUESSES_LIMIT),
  guessMode: z.enum(['search', 'choice']).optional(),
});

categoriesRouter.post(
  '/:categoryId/challenge/today/guess',
  guessRateLimiter,
  validate(categoryIdParamsSchema, 'params'),
  validate(guessSchema),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params as unknown as z.infer<typeof categoryIdParamsSchema>;
    const { deezerTrackId, guessNumber, guessMode } = req.body as z.infer<typeof guessSchema>;

    const identity = getIdentity(req);
    const active = await getActiveSessionForSource(sourceFor(categoryId), identity);

    if (!active) {
      res.status(409).json({ error: 'No active session found for this category challenge' });
      return;
    }

    const { session, challenge } = active;
    const tracks = await loadChallengeTracks(challenge.id);

    const currentTrack = tracks[session.currentRound];
    if (!currentTrack) {
      throw new HttpError(500, 'Challenge round is out of range');
    }

    const snippetSchedule = await getSnippetSchedule();
    /*
     * Clamped rather than rejected.
     *
     * A guess number past the end of the schedule means "this is my last attempt", which is a
     * sane thing to act on — the old behaviour was a 400 that reached the player as "Something
     * went wrong submitting that", with nothing to do about it. It shipped for real: Skip sent
     * a hardcoded 6 from when the schedule had six stages, and every Skip failed once an admin
     * shortened it to five. Treating an over-large number as the final attempt makes that class
     * of client/settings drift harmless instead of fatal.
     */
    const effectiveGuessNumber = Math.min(guessNumber, snippetSchedule.length);

    const correct = deezerTrackId !== undefined && deezerTrackId === currentTrack.deezerTrackId;

    // For multiple choice, there's only one chance to guess correctly per round.
    const final =
      guessMode === 'choice'
        ? true
        : isFinalAttempt(effectiveGuessNumber, correct, snippetSchedule.length);

    if (!final) {
      res.json({ correct, isFinal: false });
      return;
    }

    const snippetStageSeconds = snippetSecondsForGuess(effectiveGuessNumber, snippetSchedule);

    const { sessionComplete, songsCorrect, totalGuessesUsed, timeTakenSeconds, totalRounds } =
      await recordArtistRoundResult(session.id, correct, effectiveGuessNumber, snippetStageSeconds);

    res.json({
      correct,
      isFinal: true,
      song: {
        title: currentTrack.title,
        artist: currentTrack.artist,
        albumArtUrl: currentTrack.albumArtUrl,
      },
      songsCorrect,
      currentRound: session.currentRound,
      sessionComplete,
      timeTakenSeconds,
      ...(sessionComplete
        ? {
            finalScore: {
              songsCorrect,
              totalGuessesUsed,
              timeTakenSeconds,
              totalRounds,
            },
          }
        : {}),
    });
  }),
);

categoriesRouter.get(
  '/:categoryId/challenge/:challengeId/leaderboard',
  validate(
    categoryIdParamsSchema.extend({ challengeId: z.coerce.number().int().positive() }),
    'params',
  ),
  asyncHandler(async (req, res) => {
    const { challengeId } = req.params as unknown as { challengeId: number };
    res.json(await getChallengeLeaderboard(challengeId, getIdentity(req)));
  }),
);

categoriesRouter.get(
  '/:categoryId/leaderboard',
  validate(categoryIdParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params as unknown as z.infer<typeof categoryIdParamsSchema>;
    res.json(
      await getSourceLeaderboard('category', sourceFor(categoryId).sourceId, getIdentity(req)),
    );
  }),
);

categoriesRouter.get(
  '/:categoryId/stats/guess-distribution',
  validate(categoryIdParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params as unknown as z.infer<typeof categoryIdParamsSchema>;
    res.json(
      await getSourceGuessDistribution(
        'category',
        sourceFor(categoryId).sourceId,
        getIdentity(req),
      ),
    );
  }),
);
