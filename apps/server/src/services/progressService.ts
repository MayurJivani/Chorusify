/**
 * Progression: level, XP, and what a player has actually mastered.
 *
 * Everything here is *derived* from the runs already recorded rather than counted into a new
 * column. A stored XP total would be a second source of truth that drifts the first time a
 * write is missed or replayed, and it would be wrong for every player who played before it
 * existed. Deriving costs a few aggregate queries and is right by construction, including
 * retroactively.
 *
 * Absolute, not relative. "You have named 47 Queen songs" means something on day one; "top 3%
 * of Queen fans" means nothing until there are enough players to have a distribution.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { Identity } from '../auth/identity';
import { findCategory, type CategoryGroup } from './categories';

/** XP per song correctly named in a ten-round run, and per song survived in Survival. */
const XP_PER_SONG = 10;
/** A daily puzzle is one song, but it is the shared one and it expires, so it is worth more. */
const XP_PER_DAILY_WIN = 25;
/** Winning a rated duel is worth a day's puzzle on top of the songs it took to win it. */
const XP_PER_DUEL_WIN = 25;

/**
 * XP needed to *reach* a level, on a gently accelerating curve.
 *
 * Quadratic rather than exponential: exponential curves make the first levels feel free and
 * every later one unreachable, which is the opposite of what a casual game wants.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * (level - 1) * level;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at which this level began, and at which the next one starts. */
  levelStartXp: number;
  nextLevelXp: number;
  /** 0 to 1 through the current level, for a progress bar. */
  progress: number;
}

export function levelForXp(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(xp));

  let level = 1;
  while (xpForLevel(level + 1) <= safeXp) level += 1;

  const levelStartXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const span = nextLevelXp - levelStartXp;

  return {
    level,
    xp: safeXp,
    levelStartXp,
    nextLevelXp,
    progress: span > 0 ? (safeXp - levelStartXp) / span : 0,
  };
}

export interface ModeBreakdown {
  songsCorrect: number;
  songsPossible: number;
  accuracy: number;
  runs: number;
}

export interface MasteryEntry {
  sourceType: string;
  sourceId: string;
  label: string;
  runs: number;
  songsCorrect: number;
  songsPossible: number;
  accuracy: number;
  bestRun: number;
  fastestRunSeconds: number | null;
}

export interface ProgressSummary {
  level: LevelProgress;
  /** Where the XP came from, so the number is explainable rather than magic. */
  sources: { songs: number; dailyWins: number; duelWins: number; survival: number };
  byMode: Record<'artist' | 'category' | 'era', ModeBreakdown>;
  /** Category runs split by what kind of category, which is the closest thing we have to
   *  "accuracy by decade vs genre" without inventing new data. */
  byCategoryGroup: Partial<Record<CategoryGroup, ModeBreakdown>>;
  survival: { runs: number; bestStreak: number; totalSongs: number };
  daily: { played: number; won: number };
  duels: { played: number; won: number; rating: number | null };
  mastery: MasteryEntry[];
}

function ownerKey(identity: Identity): string {
  return identity.userId ?? identity.guestId ?? '';
}

function accuracy(correct: number, possible: number): number {
  return possible > 0 ? Math.round((correct / possible) * 100) : 0;
}

/**
 * Everything a player has done, in one payload.
 *
 * Deliberately one call: a progress page that fires eight requests spends longer assembling
 * itself than the player spends reading it.
 */
export async function getProgress(identity: Identity): Promise<ProgressSummary> {
  const key = ownerKey(identity);
  const userId = identity.userId;

  const [runRows, survivalRows, dailyRows, duelRows] = await Promise.all([
    db.execute(sql`
      SELECT
        c.source_type                              AS "sourceType",
        c.deezer_artist_id                         AS "sourceId",
        MAX(c.artist_name)                         AS "label",
        COUNT(*)::int                              AS "runs",
        COALESCE(SUM(r.songs_correct), 0)::int     AS "songsCorrect",
        COALESCE(SUM(c.total_rounds), 0)::int      AS "songsPossible",
        COALESCE(MAX(r.songs_correct), 0)::int     AS "bestRun",
        MIN(r.time_taken_seconds)::int             AS "fastestRunSeconds"
      FROM artist_session_results r
      JOIN artist_challenges c ON c.id = r.challenge_id
      WHERE r.completed = true AND COALESCE(r.user_id, r.guest_id) = ${key}
      GROUP BY c.source_type, c.deezer_artist_id
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int                        AS "runs",
        COALESCE(MAX(streak), 0)::int        AS "bestStreak",
        COALESCE(SUM(streak), 0)::int        AS "totalSongs"
      FROM survival_runs
      WHERE ended_at IS NOT NULL
        AND COALESCE(user_id, guest_id) = ${key}
    `),
    // Daily mode is now a multi-song session (up to SLOTS_PER_DAY game_results rows per day),
    // so "days played/won" has to come from user_stats' day-level counters rather than a raw
    // game_results count — counting rows directly here would count songs, not days, and would
    // silently inflate this 5x (which also feeds the XP total below via dailyWins).
    db.execute(sql`
      SELECT games_played AS "played", games_won AS "won"
      FROM user_stats
      WHERE owner_key = ${key}
    `),
    userId
      ? db.execute(sql`
          SELECT
            COUNT(*)::int                                       AS "played",
            COUNT(*) FILTER (WHERE winner_id = ${userId})::int   AS "won",
            (SELECT rating FROM users WHERE id = ${userId})      AS "rating"
          FROM duels
          WHERE status = 'complete'
            AND (challenger_id = ${userId} OR opponent_id = ${userId})
        `)
      : Promise.resolve([{ played: 0, won: 0, rating: null }] as unknown as never),
  ]);

  const runs = runRows as unknown as (MasteryEntry & { sourceType: string })[];
  const survival = (survivalRows as unknown as ProgressSummary['survival'][])[0] ?? {
    runs: 0,
    bestStreak: 0,
    totalSongs: 0,
  };
  const daily = (dailyRows as unknown as ProgressSummary['daily'][])[0] ?? { played: 0, won: 0 };
  const duels = (duelRows as unknown as ProgressSummary['duels'][])[0] ?? {
    played: 0,
    won: 0,
    rating: null,
  };

  const emptyMode = (): ModeBreakdown => ({
    songsCorrect: 0,
    songsPossible: 0,
    accuracy: 0,
    runs: 0,
  });
  const byMode = {
    artist: emptyMode(),
    category: emptyMode(),
    era: emptyMode(),
  } as ProgressSummary['byMode'];
  const byCategoryGroup: ProgressSummary['byCategoryGroup'] = {};

  const mastery: MasteryEntry[] = [];
  let songsCorrectTotal = 0;

  for (const row of runs) {
    songsCorrectTotal += row.songsCorrect;

    const mode = byMode[row.sourceType as keyof ProgressSummary['byMode']];
    if (mode) {
      mode.runs += row.runs;
      mode.songsCorrect += row.songsCorrect;
      mode.songsPossible += row.songsPossible;
    }

    if (row.sourceType === 'category') {
      const group = findCategory(row.sourceId)?.group;
      if (group) {
        const bucket = (byCategoryGroup[group] ??= emptyMode());
        bucket.runs += row.runs;
        bucket.songsCorrect += row.songsCorrect;
        bucket.songsPossible += row.songsPossible;
      }
    }

    // Era is one global pool, so it is a mode rather than something to be a fan of.
    if (row.sourceType !== 'era') {
      mastery.push({
        ...row,
        accuracy: accuracy(row.songsCorrect, row.songsPossible),
      });
    }
  }

  for (const bucket of [...Object.values(byMode), ...Object.values(byCategoryGroup)]) {
    bucket.accuracy = accuracy(bucket.songsCorrect, bucket.songsPossible);
  }

  mastery.sort((a, b) => b.songsCorrect - a.songsCorrect || b.runs - a.runs);

  const sources = {
    songs: songsCorrectTotal * XP_PER_SONG,
    dailyWins: daily.won * XP_PER_DAILY_WIN,
    duelWins: duels.won * XP_PER_DUEL_WIN,
    survival: survival.totalSongs * XP_PER_SONG,
  };
  const xp = sources.songs + sources.dailyWins + sources.duelWins + sources.survival;

  return {
    level: levelForXp(xp),
    sources,
    byMode,
    byCategoryGroup,
    survival,
    daily,
    duels,
    mastery: mastery.slice(0, 20),
  };
}
