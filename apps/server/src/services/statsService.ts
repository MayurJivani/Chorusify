import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { gameResults, userStats } from '../db/schema';
import { getSnippetSchedule } from './puzzleService';

const GUESS_DIST_COLUMNS = [
  'guessDist1',
  'guessDist2',
  'guessDist3',
  'guessDist4',
  'guessDist5',
  'guessDist6',
] as const;

function yesterday(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export interface RecordDayResultInput {
  ownerKey: string; // userId if authenticated, else guestId
  puzzleDate: string; // 'YYYY-MM-DD'
  /** This day's results, one per completed song slot (SLOTS_PER_DAY of them). */
  slots: { won: boolean; guessesUsed: number }[];
}

/**
 * Called once a day, when the last of that day's song slots is finished — never per song.
 *
 * The streak tracks day *completion*, not correctness: finishing all of today's songs continues
 * it even on a day where every guess was wrong. `gamesWon` is looser than a streak-worthy day —
 * it only needs one correct song — while `perfectDays` is the strict all-correct subset of it,
 * so "partial win" (some but not all correct) is always `gamesWon - perfectDays`, not a counter
 * of its own.
 */
export async function recordGameResult(input: RecordDayResultInput): Promise<void> {
  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(userStats)
      .where(eq(userStats.ownerKey, input.ownerKey))
      .limit(1);
    const existing = existingRows[0];

    // Idempotent per day: a date whose slot count changes mid-day (e.g. a deploy that adds
    // songs to a day someone already finished under the old single-song puzzle) could
    // otherwise re-trigger this a second time for the same date, wrongly resetting the streak
    // and double-counting gamesPlayed. Once a day is recorded, a second call for it is a no-op.
    if (existing?.lastPlayedDate === input.puzzleDate) return;

    const continuesStreak = existing?.lastPlayedDate === yesterday(input.puzzleDate);
    const currentStreak = continuesStreak ? (existing?.currentStreak ?? 0) + 1 : 1;
    const maxStreak = Math.max(currentStreak, existing?.maxStreak ?? 0);

    const correctCount = input.slots.filter((s) => s.won).length;
    const wonDay = correctCount >= 1;
    const perfectDay = correctCount === input.slots.length;

    const base = {
      currentStreak,
      maxStreak,
      gamesPlayed: (existing?.gamesPlayed ?? 0) + 1,
      gamesWon: (existing?.gamesWon ?? 0) + (wonDay ? 1 : 0),
      perfectDays: (existing?.perfectDays ?? 0) + (perfectDay ? 1 : 0),
      lastPlayedDate: input.puzzleDate,
      updatedAt: new Date(),
    };

    const distUpdate: Partial<Record<(typeof GUESS_DIST_COLUMNS)[number], number>> = {};
    for (const slot of input.slots) {
      if (!slot.won || slot.guessesUsed < 1 || slot.guessesUsed > 6) continue;
      const column = GUESS_DIST_COLUMNS[slot.guessesUsed - 1]!;
      distUpdate[column] = (distUpdate[column] ?? existing?.[column] ?? 0) + 1;
    }

    if (existing) {
      await tx
        .update(userStats)
        .set({ ...base, ...distUpdate })
        .where(eq(userStats.ownerKey, input.ownerKey));
    } else {
      await tx.insert(userStats).values({ ownerKey: input.ownerKey, ...base, ...distUpdate });
    }
  });
}

export async function getStats(ownerKey: string) {
  const rows = await db.select().from(userStats).where(eq(userStats.ownerKey, ownerKey)).limit(1);
  return rows[0] ?? null;
}

export interface SolveTimeStats {
  /** Mean seconds across won puzzles that have a recorded time. */
  averageSolveSeconds: number | null;
  fastestSolveSeconds: number | null;
  slowestSolveSeconds: number | null;
  /** Total seconds spent on finished puzzles, wins and losses alike. */
  totalPlaySeconds: number;
  /** Mean guesses used across wins — the "how close to the wire" number. */
  averageGuessesPerWin: number | null;
  /** Mean seconds of snippet a win needed, derived from the reveal ladder. */
  averageSnippetSeconds: number | null;
  /** Wins that have a recorded time; the rest predate timing and are excluded from averages. */
  timedWins: number;
}

/**
 * Per-player aggregates that `user_stats` doesn't carry.
 *
 * These are computed from `game_results` rather than kept as running counters because they
 * are averages and extrema — a counter would have to be rewritten on every play and could not
 * be recomputed if it ever drifted. `time_taken_seconds` is null for anything recorded before
 * timing existed, so every average is taken over the timed subset and `timedWins` reports how
 * much of the history that actually covers.
 */
export async function getSolveTimeStats(ownerKey: string): Promise<SolveTimeStats> {
  const rows = (await db.execute(sql`
    SELECT
      AVG(time_taken_seconds) FILTER (WHERE won AND time_taken_seconds IS NOT NULL)      AS "avgWin",
      MIN(time_taken_seconds) FILTER (WHERE won AND time_taken_seconds IS NOT NULL)::int AS "fastest",
      MAX(time_taken_seconds) FILTER (WHERE won AND time_taken_seconds IS NOT NULL)::int AS "slowest",
      COALESCE(SUM(time_taken_seconds), 0)::int                                          AS "totalSeconds",
      COUNT(*) FILTER (WHERE won AND time_taken_seconds IS NOT NULL)::int                AS "timedWins",
      AVG(guesses_used) FILTER (WHERE won)                                               AS "avgGuesses",
      AVG(snippet_stage_reached) FILTER (WHERE won)                                      AS "avgStage"
    FROM game_results
    WHERE COALESCE(user_id, guest_id) = ${ownerKey}
  `)) as unknown as {
    avgWin: string | null;
    fastest: number | null;
    slowest: number | null;
    totalSeconds: number;
    timedWins: number;
    avgGuesses: string | null;
    avgStage: string | null;
  }[];

  const row = rows[0];
  // AVG returns numeric, which postgres-js hands back as a string — parse rather than trust
  // the declared type, the same trap that made the artist guess histogram concatenate.
  const num = (value: string | null): number | null => (value == null ? null : Number(value));

  const avgStage = num(row?.avgStage ?? null);
  // Indexed against the live schedule, not a constant — an admin can change both its values
  // and its length, and a stale ladder would report the wrong number of seconds.
  const schedule = await getSnippetSchedule();

  return {
    averageSolveSeconds: round1(num(row?.avgWin ?? null)),
    fastestSolveSeconds: row?.fastest ?? null,
    slowestSolveSeconds: row?.slowest ?? null,
    totalPlaySeconds: row?.totalSeconds ?? 0,
    averageGuessesPerWin: round1(num(row?.avgGuesses ?? null)),
    // snippet_stage_reached is a 0-based index into the reveal ladder.
    averageSnippetSeconds:
      avgStage == null
        ? null
        : round1(schedule[Math.min(Math.round(avgStage), schedule.length - 1)] ?? null),
    timedWins: row?.timedWins ?? 0,
  };
}

function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

/** Migrates a guest's history onto a freshly-registered user account. */
export async function mergeGuestStatsIntoUser(guestId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const guestStatsRows = await tx
      .select()
      .from(userStats)
      .where(eq(userStats.ownerKey, guestId))
      .limit(1);
    const guestStats = guestStatsRows[0];
    const userStatsRows = await tx
      .select()
      .from(userStats)
      .where(eq(userStats.ownerKey, userId))
      .limit(1);
    const userStatsRow = userStatsRows[0];

    // A brand-new account should never already have stats, but guard defensively rather than clobber.
    if (guestStats && !userStatsRow) {
      await tx.insert(userStats).values({ ...guestStats, ownerKey: userId });
      await tx.delete(userStats).where(eq(userStats.ownerKey, guestId));
    }

    await tx
      .update(gameResults)
      .set({ userId })
      .where(and(eq(gameResults.guestId, guestId), isNull(gameResults.userId)));
  });
}
