import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/client';
import { dailyPuzzles, dailyPuzzleStarts, songs, type DailyPuzzle } from '../db/schema';
import { hashString } from '../utils/deterministic';
import { getSettings } from './settingsService';

/** A daily session is this many songs, Songless-style, not one. */
export const SLOTS_PER_DAY = 5;

/**
 * The default snippet schedule: seconds of audio revealed at each guess stage, Heardle-style.
 *
 * Kept as a constant because it is the fallback the settings service returns when nothing is
 * stored, and because a few places (request validation built at import time) need *some* bound
 * before any await is possible. The live schedule comes from `getSnippetSchedule()`.
 */
export const SNIPPET_SCHEDULE_SECONDS = [1, 2, 4, 7, 11, 16] as const;
export const MAX_GUESSES = SNIPPET_SCHEDULE_SECONDS.length;

/** The largest guess count any schedule may produce; bounds request validation, which cannot
 *  await the current setting. Anything above the live schedule length is rejected afterwards. */
export const MAX_GUESSES_LIMIT = 10;

/** The snippet schedule currently in force. */
export async function getSnippetSchedule(): Promise<number[]> {
  return (await getSettings()).snippetScheduleSeconds;
}

/** Seconds of audio a given (1-based) guess number is allowed to hear. */
export function snippetSecondsForGuess(guessNumber: number, schedule: readonly number[]): number {
  return (
    schedule[Math.min(guessNumber, schedule.length) - 1] ?? schedule[schedule.length - 1] ?? 16
  );
}

export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Candidate songs for the daily puzzle, ordered by id.
 *
 * The ORDER BY is load-bearing, not cosmetic: the song is chosen by indexing into this array
 * with a hash of the date, and Postgres makes no ordering guarantee without it. Row order can
 * shift after any UPDATE (the chart sync rewrites `active`/`verified_at` constantly), so the
 * "deterministic" pick would quietly resolve to a different song from one day to the next.
 */
async function selectPool(curatedOnly: boolean) {
  return db
    .select({ id: songs.id })
    .from(songs)
    .where(
      curatedOnly
        ? and(eq(songs.active, true), eq(songs.manualOverride, true))
        : eq(songs.active, true),
    )
    .orderBy(asc(songs.id));
}

/**
 * Which song the automatic picker would choose for a given seed, given what has been used
 * recently. The seed is a date for a single-slot pick, or `${date}#${position}` for one slot of
 * a multi-song day — the function only hashes it, so it doesn't need to know which.
 *
 * Pulled out of `getOrCreateDailyPuzzles` so the admin page can *project* upcoming days without
 * creating rows for them. Creating a row to find out what it would be is not a preview: it
 * pins the answer and, worse, feeds the recently-used window for every slot after it.
 */
export function pickSongForDate(
  seed: string,
  activeSongIds: readonly number[],
  recentlyUsedIds: ReadonlySet<number>,
): number | null {
  if (activeSongIds.length === 0) return null;

  const candidates = activeSongIds.filter((id) => !recentlyUsedIds.has(id));
  const pool = candidates.length > 0 ? candidates : activeSongIds;

  return pool[hashString(seed) % pool.length] ?? null;
}

/** The eligible song ids, honouring the curated-only setting with its degrade-not-fail fallback. */
async function eligibleSongIds(): Promise<number[]> {
  const { dailyCuratedOnly } = await getSettings();
  const curated = dailyCuratedOnly ? await selectPool(true) : [];
  const active = curated.length > 0 ? curated : await selectPool(false);
  return active.map((s) => s.id);
}

export interface UpcomingSlot {
  puzzleDate: string;
  position: number;
  songId: number | null;
  /** True when a row already exists, i.e. someone played that slot or an admin pinned it.
   *  False means this is what the picker *would* choose, and is still free to change. */
  scheduled: boolean;
}

/**
 * What the next `days` days will play, projected forward from today, one entry per song slot.
 *
 * The projection has to be sequential, not per-slot: each slot the picker excludes recently used
 * songs, so day three's answers depend on what days one and two took. Simulating them in order
 * with a running window is the only way to preview honestly — asking "what would day three be"
 * in isolation would ignore the slots about to be created before it.
 */
export async function previewUpcomingPuzzles(days = 14): Promise<UpcomingSlot[]> {
  const activeSongIds = await eligibleSongIds();
  const recentWindow = Math.max(0, activeSongIds.length - 1);

  const alreadyUsed =
    recentWindow > 0
      ? await db
          .select({ songId: dailyPuzzles.songId })
          .from(dailyPuzzles)
          .orderBy(desc(dailyPuzzles.puzzleDate), desc(dailyPuzzles.position))
          .limit(recentWindow)
      : [];

  // A queue rather than a set, so the window can drop its oldest entry as the projection walks
  // forward — exactly what the real picker's `LIMIT recentWindow` does slot to slot.
  const window: number[] = alreadyUsed.map((r) => r.songId);

  const today = new Date(`${getUtcDateString()}T00:00:00Z`);
  const pinned = await db
    .select({
      puzzleDate: dailyPuzzles.puzzleDate,
      position: dailyPuzzles.position,
      songId: dailyPuzzles.songId,
    })
    .from(dailyPuzzles)
    .where(gte(dailyPuzzles.puzzleDate, getUtcDateString()));
  const pinnedByKey = new Map(pinned.map((p) => [`${p.puzzleDate}#${p.position}`, p.songId]));

  const result: UpcomingSlot[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
    const puzzleDate = getUtcDateString(date);
    // A day's own slots can't repeat each other, same as the real picker.
    const pickedThisDay = new Set<number>();

    for (let position = 1; position <= SLOTS_PER_DAY; position += 1) {
      const seed = `${puzzleDate}#${position}`;
      const existing = pinnedByKey.get(seed);
      const exclude = new Set([...window.slice(0, recentWindow), ...pickedThisDay]);
      const songId = existing ?? pickSongForDate(seed, activeSongIds, exclude);

      result.push({ puzzleDate, position, songId: songId ?? null, scheduled: existing != null });

      // Whatever that slot takes becomes the newest entry of the window the next slot sees.
      if (songId != null) {
        window.unshift(songId);
        pickedThisDay.add(songId);
      }
    }
  }

  return result;
}

/**
 * The day's songs, in position order, creating any that don't exist yet.
 *
 * Each missing position is filled independently (same race-safe `onConflictDoNothing` pattern
 * the single-song version used), excluding both the cross-day "recently used" window below and
 * whatever this same call has already picked for an earlier position today — a day's five songs
 * must be distinct from each other, not just from recent days.
 */
export async function getOrCreateDailyPuzzles(puzzleDate: string): Promise<DailyPuzzle[]> {
  const existingRows = await db
    .select()
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.puzzleDate, puzzleDate))
    .orderBy(asc(dailyPuzzles.position));
  if (existingRows.length >= SLOTS_PER_DAY) {
    return existingRows;
  }

  // The bank holds two very different populations: a hand-curated all-time list
  // (`manual_override`) and whatever is currently on Deezer's worldwide chart, which the
  // playlist sync rotates in and out. Only the curated list is eligible for the daily puzzle
  // — chart entries turn over constantly, so a shared "song of the day" drawn from them
  // would often be something most players have never heard. The chart sync still keeps the
  // bank fresh; it just doesn't decide the daily. If curation hasn't run yet, fall back to
  // every active song so the game degrades instead of failing.
  const activeSongIds = await eligibleSongIds();
  if (activeSongIds.length === 0) {
    throw new Error('No active songs available to build a daily puzzle');
  }

  // Never repeat a song until every other active song has had a turn: exclude whatever was
  // used in the most recent (activeCount - 1) slots from today's candidate pool. This window
  // is recomputed from the *current* active count every call, so it self-heals as songs are
  // added/deactivated by the curation scripts over time.
  const recentWindow = Math.max(0, activeSongIds.length - 1);
  const recentlyUsed =
    recentWindow > 0
      ? await db
          .select({ songId: dailyPuzzles.songId })
          .from(dailyPuzzles)
          .orderBy(desc(dailyPuzzles.puzzleDate), desc(dailyPuzzles.position))
          .limit(recentWindow)
      : [];
  const recentlyUsedIds = new Set(recentlyUsed.map((r) => r.songId));

  const existingPositions = new Set(existingRows.map((r) => r.position));
  const pickedThisDay = new Set(existingRows.map((r) => r.songId));
  const rows: DailyPuzzle[] = [...existingRows];

  for (let position = 1; position <= SLOTS_PER_DAY; position += 1) {
    if (existingPositions.has(position)) continue;

    const exclude = new Set([...recentlyUsedIds, ...pickedThisDay]);
    const chosenId = pickSongForDate(`${puzzleDate}#${position}`, activeSongIds, exclude);
    if (chosenId == null) {
      throw new Error('Failed to select a song for the daily puzzle');
    }

    // At the UTC rollover several players hit this path at once. The (date, position) pair is
    // unique, so only one insert per slot can win; the losers get no row back and simply read
    // the winner's pick instead of erroring — everyone still ends up on the same five songs.
    const insertedRows = await db
      .insert(dailyPuzzles)
      .values({ puzzleDate, position, songId: chosenId })
      .onConflictDoNothing({ target: [dailyPuzzles.puzzleDate, dailyPuzzles.position] })
      .returning();
    const row =
      insertedRows[0] ??
      (
        await db
          .select()
          .from(dailyPuzzles)
          .where(and(eq(dailyPuzzles.puzzleDate, puzzleDate), eq(dailyPuzzles.position, position)))
          .limit(1)
      )[0];
    if (!row) {
      throw new Error('Failed to create the daily puzzle');
    }

    rows.push(row);
    pickedThisDay.add(row.songId);
  }

  return rows.sort((a, b) => a.position - b.position);
}

/**
 * Stamps when this player first opened the puzzle, if it isn't already stamped.
 *
 * `onConflictDoNothing` is what makes the timing honest: reloading the page, or opening it in
 * a second tab, must not reset the clock, so only the first view ever wins.
 */
export async function markPuzzleStarted(ownerKey: string, puzzleId: number): Promise<void> {
  await db
    .insert(dailyPuzzleStarts)
    .values({ ownerKey, puzzleId })
    .onConflictDoNothing({ target: [dailyPuzzleStarts.ownerKey, dailyPuzzleStarts.puzzleId] });
}

/** Seconds between this player's first view of the puzzle and now, or null if never stamped
 *  (results predating the timing feature, or a client that went straight to guessing). */
export async function getElapsedPuzzleSeconds(
  ownerKey: string,
  puzzleId: number,
): Promise<number | null> {
  const rows = await db
    .select({ startedAt: dailyPuzzleStarts.startedAt })
    .from(dailyPuzzleStarts)
    .where(and(eq(dailyPuzzleStarts.ownerKey, ownerKey), eq(dailyPuzzleStarts.puzzleId, puzzleId)))
    .limit(1);

  const startedAt = rows[0]?.startedAt;
  if (!startedAt) return null;
  return Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
}

export async function getSongById(songId: number) {
  const rows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
  return rows[0] ?? null;
}
