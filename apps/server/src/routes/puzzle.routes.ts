import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { gameResults, type DailyPuzzle } from '../db/schema';
import {
  getOrCreateDailyPuzzles,
  getElapsedPuzzleSeconds,
  getSongById,
  getUtcDateString,
  markPuzzleStarted,
  getSnippetSchedule,
  MAX_GUESSES_LIMIT,
} from '../services/puzzleService';
import { isCorrectGuess, isFinalAttempt } from '../services/guessService';
import { recordGameResult, getStats } from '../services/statsService';
import { getFreshPreviewUrl } from '../services/deezerService';
import { ensureDailyPlaylistsFresh } from '../services/dailyPlaylistService';
import { validate } from '../middleware/validate';
import { guessRateLimiter } from '../middleware/rateLimiters';
import { HttpError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { getIdentity } from '../auth/identity';
import { normalizeTitle } from '../utils/trackFilters';
import type { Request } from 'express';

export const puzzleRouter = Router();

/** Postgres's SQLSTATE for a unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/** This player's results for today, keyed by which slot they belong to. */
async function loadTodaysResults(puzzles: DailyPuzzle[], req: Request) {
  const { userId, guestId } = getIdentity(req);
  const ownerFilter = userId
    ? eq(gameResults.userId, userId)
    : eq(gameResults.guestId, guestId ?? '');
  const rows = await db
    .select()
    .from(gameResults)
    .where(
      and(
        inArray(
          gameResults.puzzleId,
          puzzles.map((p) => p.id),
        ),
        ownerFilter,
      ),
    );
  return new Map(rows.map((r) => [r.puzzleId, r]));
}

/** Whether a wrong guess at least picked a song by the same artist as the answer. Artist names
 *  are compared normalized so "Beyoncé" and "Beyonce" count as a match. */
async function isSameArtist(guessedSongId: number | undefined, answerSongId: number) {
  if (guessedSongId === undefined) return false;

  const [guessed, answer] = await Promise.all([
    getSongById(guessedSongId),
    getSongById(answerSongId),
  ]);
  if (!guessed || !answer) return false;

  return normalizeTitle(guessed.artist) === normalizeTitle(answer.artist);
}

async function revealSong(songId: number) {
  const song = await getSongById(songId);
  if (!song) return null;
  return { title: song.title, artist: song.artist, albumArtUrl: song.albumArtUrl };
}

puzzleRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    await ensureDailyPlaylistsFresh();
    const puzzleDate = getUtcDateString();
    const puzzles = await getOrCreateDailyPuzzles(puzzleDate);
    const resultsByPuzzleId = await loadTodaysResults(puzzles, req);

    const completedSlots = await Promise.all(
      puzzles
        .filter((p) => resultsByPuzzleId.has(p.id))
        .map(async (p) => {
          const result = resultsByPuzzleId.get(p.id)!;
          return {
            position: p.position,
            won: result.won,
            guessesUsed: result.guessesUsed,
            song: await revealSong(p.songId),
          };
        }),
    );

    const current = puzzles.find((p) => !resultsByPuzzleId.has(p.id));

    if (!current) {
      res.json({
        puzzleDate,
        completed: true,
        slots: completedSlots,
        correctCount: completedSlots.filter((s) => s.won).length,
        totalSlots: puzzles.length,
        snippetSchedule: await getSnippetSchedule(),
      });
      return;
    }

    const song = await getSongById(current.songId);
    if (!song) {
      throw new HttpError(500, 'Puzzle song is missing from the song bank');
    }

    // Start the clock the first time this player is handed this slot.
    const { userId, guestId } = getIdentity(req);
    await markPuzzleStarted(userId ?? guestId ?? req.session.guestId, current.id);

    // The stored preview_url is a curation-time snapshot — Deezer's signed preview links
    // expire in minutes, so the URL actually handed to a player is always fetched live.
    const fresh = await getFreshPreviewUrl(song.deezerTrackId);
    if (!fresh) {
      throw new HttpError(503, 'This song is temporarily unavailable, please try again shortly');
    }

    res.json({
      puzzleId: current.id,
      puzzleDate,
      completed: false,
      position: current.position,
      totalSlots: puzzles.length,
      completedSlots,
      previewUrl: fresh.previewUrl,
      snippetSchedule: await getSnippetSchedule(),
      maxGuesses: (await getSnippetSchedule()).length,
    });
  }),
);

const guessSchema = z.object({
  // Omitted entirely for a "skip" — the attempt is spent without guessing a specific song.
  songId: z.number().int().positive().optional(),
  // Bounded by the largest schedule any setting allows, because a zod schema is built at
  // import time and cannot await the live one; the handler rejects anything over it.
  guessNumber: z.number().int().min(1).max(MAX_GUESSES_LIMIT),
});

puzzleRouter.post(
  '/today/guess',
  guessRateLimiter,
  validate(guessSchema),
  asyncHandler(async (req, res) => {
    await ensureDailyPlaylistsFresh();
    const puzzleDate = getUtcDateString();
    const puzzles = await getOrCreateDailyPuzzles(puzzleDate);
    const resultsByPuzzleId = await loadTodaysResults(puzzles, req);
    // Never trust a client-supplied slot: the current slot is always the first one this player
    // hasn't got a result for yet, so there's nothing to skip ahead to or replay.
    const current = puzzles.find((p) => !resultsByPuzzleId.has(p.id));

    if (!current) {
      res.status(409).json({ error: "Today's puzzle has already been completed" });
      return;
    }

    const { songId, guessNumber } = req.body as z.infer<typeof guessSchema>;
    const snippetSchedule = await getSnippetSchedule();
    if (guessNumber > snippetSchedule.length) {
      throw new HttpError(400, 'That guess number is past the end of the snippet schedule');
    }

    const correct = songId !== undefined && isCorrectGuess(songId, current.songId);
    const final = isFinalAttempt(guessNumber, correct, snippetSchedule.length);

    let dayComplete = false;
    let daySummary:
      | { correctCount: number; totalSlots: number; currentStreak: number; maxStreak: number }
      | undefined;

    if (final) {
      const { userId, guestId } = getIdentity(req);
      const ownerKey = userId ?? guestId ?? req.session.guestId;
      const timeTakenSeconds = await getElapsedPuzzleSeconds(ownerKey, current.id);

      try {
        await db.insert(gameResults).values({
          userId,
          guestId,
          puzzleId: current.id,
          won: correct,
          guessesUsed: guessNumber,
          snippetStageReached: guessNumber - 1,
          timeTakenSeconds,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ error: "Today's puzzle has already been completed" });
          return;
        }
        throw err;
      }

      // Only the request that inserts the day's last remaining slot ever sees every slot
      // filled, so this fires the day-level stats update exactly once per day.
      const todaysResults = await loadTodaysResults(puzzles, req);
      if (todaysResults.size === puzzles.length) {
        dayComplete = true;
        const rows = [...todaysResults.values()];
        await recordGameResult({
          ownerKey,
          puzzleDate,
          slots: rows.map((r) => ({ won: r.won, guessesUsed: r.guessesUsed })),
        });
        const stats = await getStats(ownerKey);
        daySummary = {
          correctCount: rows.filter((r) => r.won).length,
          totalSlots: puzzles.length,
          currentStreak: stats?.currentStreak ?? 0,
          maxStreak: stats?.maxStreak ?? 0,
        };
      }
    }

    res.json({
      correct,
      isFinal: final,
      position: current.position,
      totalSlots: puzzles.length,
      // "You had the right artist" is the one piece of feedback a snippet game can give that
      // actually narrows the search, and it costs nothing to compute. It is derived on the
      // server rather than by comparing artist strings in the browser, because the client is
      // never told the answer's artist until the slot is over — sending it would hand over
      // the answer to anyone opening the network tab.
      sameArtist: !correct && !final ? await isSameArtist(songId, current.songId) : undefined,
      song: final ? await revealSong(current.songId) : undefined,
      dayComplete: final ? dayComplete : undefined,
      daySummary,
    });
  }),
);
