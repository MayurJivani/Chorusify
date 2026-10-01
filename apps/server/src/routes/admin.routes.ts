/**
 * The admin command centre: dashboard metrics, runtime game settings, and the daily schedule.
 *
 * Two rules run through the schedule endpoints:
 *  - A puzzle that people have already played is *history*, not schedule. Editing or deleting it
 *    would orphan or silently rewrite their results, so it is refused outright.
 *  - The past is never editable, even if unplayed, because there is nothing to gain from it.
 *
 * Settings are validated against the registry in `settingsService`, which is also what the
 * dashboard renders its controls from — so what the UI offers and what the server accepts come
 * from one definition and cannot drift.
 */
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { artistTrackPools, dailyPuzzles, gameResults, songs, users } from '../db/schema';
import { CATEGORIES, findCategory, isSoundtrackCategory } from '../services/categories';
import { getUtcDateString, previewUpcomingPuzzles, SLOTS_PER_DAY } from '../services/puzzleService';
import {
  describeSettings,
  resetSetting,
  updateSettings,
  SettingsError,
  SETTING_KEYS,
  type SettingKey,
  type SettingUpdate,
} from '../services/settingsService';
import { getMostPlayedArtists, getMostPlayedCategories } from '../services/leaderboardService';
import { activeRoomCount, listRooms, forceCloseRoom } from '../services/multiplayerService';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const dateParamsSchema = z.object({
  // A calendar date, not a free-form string: the puzzle_date column is the schedule's key.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date'),
});

// A date now holds up to SLOTS_PER_DAY songs, so editing one needs to say which.
const slotParamsSchema = dateParamsSchema.extend({
  position: z.coerce.number().int().min(1).max(SLOTS_PER_DAY),
});

const listQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * The scheduled daily puzzles, newest first, each with its song and how many people have
 * finished it — the play count is what tells an admin whether a row is still safe to change.
 */
adminRouter.get(
  '/daily-puzzles',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { from, limit = 60 } = req.query as unknown as z.infer<typeof listQuerySchema>;

    const rows = await db
      .select({
        id: dailyPuzzles.id,
        puzzleDate: dailyPuzzles.puzzleDate,
        position: dailyPuzzles.position,
        songId: songs.id,
        title: songs.title,
        artist: songs.artist,
        albumArtUrl: songs.albumArtUrl,
        active: songs.active,
        manualOverride: songs.manualOverride,
        plays: sql<number>`(
          SELECT COUNT(*)::int FROM game_results gr WHERE gr.puzzle_id = ${dailyPuzzles.id}
        )`,
      })
      .from(dailyPuzzles)
      .innerJoin(songs, eq(songs.id, dailyPuzzles.songId))
      .where(from ? gte(dailyPuzzles.puzzleDate, from) : undefined)
      .orderBy(desc(dailyPuzzles.puzzleDate), asc(dailyPuzzles.position))
      .limit(limit);

    res.json({ today: getUtcDateString(), puzzles: rows });
  }),
);

/** The song bank, filtered by title or artist. Curated songs first — those are the ones the
 *  automatic picker actually draws from, so they are what an admin usually wants. */
adminRouter.get(
  '/songs',
  validate(z.object({ q: z.string().trim().max(80).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { q } = req.query as { q?: string };

    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        albumArtUrl: songs.albumArtUrl,
        active: songs.active,
        manualOverride: songs.manualOverride,
      })
      .from(songs)
      .where(q ? or(ilike(songs.title, `%${q}%`), ilike(songs.artist, `%${q}%`)) : undefined)
      .orderBy(desc(songs.manualOverride), asc(songs.artist), asc(songs.title))
      .limit(50);

    res.json({ songs: rows });
  }),
);

async function countPlays(puzzleId: number): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(gameResults)
    .where(eq(gameResults.puzzleId, puzzleId));
  return rows[0]?.count ?? 0;
}

/**
 * Rejects any edit that would rewrite history: a past date, or a slot somebody has already
 * played. Locking is per-slot, not per-date — each position is its own independent puzzle with
 * its own players, so one played song shouldn't block editing an untouched one next to it.
 * Returns the existing row (if any) so callers don't have to look it up twice.
 */
async function assertEditable(date: string, position: number) {
  if (date < getUtcDateString()) {
    throw new HttpError(409, 'That date has already passed, past puzzles are read-only');
  }

  const rows = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.puzzleDate, date), eq(dailyPuzzles.position, position)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return null;

  const plays = await countPlays(existing.id);
  if (plays > 0) {
    throw new HttpError(
      409,
      `${plays} ${plays === 1 ? 'person has' : 'people have'} already played that song, it can no longer be changed`,
    );
  }
  return existing;
}

/** Schedules (or re-points) one song slot for a date. */
adminRouter.put(
  '/daily-puzzles/:date/:position',
  validate(slotParamsSchema, 'params'),
  validate(z.object({ songId: z.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const { date, position } = req.params as unknown as z.infer<typeof slotParamsSchema>;
    const { songId } = req.body as { songId: number };

    const existing = await assertEditable(date, position);

    const songRows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
    const song = songRows[0];
    if (!song) throw new HttpError(404, 'No such song');
    if (!song.active) {
      throw new HttpError(409, 'That song is inactive, reactivate it before scheduling it');
    }

    if (existing) {
      await db.update(dailyPuzzles).set({ songId }).where(eq(dailyPuzzles.id, existing.id));
    } else {
      await db.insert(dailyPuzzles).values({ puzzleDate: date, position, songId });
    }

    res.json({
      ok: true,
      puzzleDate: date,
      position,
      song: { id: song.id, title: song.title, artist: song.artist },
    });
  }),
);

/**
 * Unschedules one slot. The automatic picker fills it back in the next time anyone opens that
 * day, so this is "re-roll this song", not "delete the day".
 */
adminRouter.delete(
  '/daily-puzzles/:date/:position',
  validate(slotParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { date, position } = req.params as unknown as z.infer<typeof slotParamsSchema>;

    const existing = await assertEditable(date, position);
    if (!existing) throw new HttpError(404, 'Nothing is scheduled for that slot');

    await db.delete(dailyPuzzles).where(eq(dailyPuzzles.id, existing.id));
    res.json({ ok: true });
  }),
);

/**
 * Curation flags for a song. `manualOverride` is what puts a song in the daily picker's pool;
 * `active` withdraws it from the game entirely.
 */
adminRouter.patch(
  '/songs/:songId',
  validate(z.object({ songId: z.coerce.number().int().positive() }), 'params'),
  validate(z.object({ active: z.boolean().optional(), manualOverride: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { songId } = req.params as unknown as { songId: number };
    const patch = req.body as { active?: boolean; manualOverride?: boolean };

    if (patch.active === undefined && patch.manualOverride === undefined) {
      throw new HttpError(400, 'Nothing to change');
    }

    const updated = await db.update(songs).set(patch).where(eq(songs.id, songId)).returning({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      active: songs.active,
      manualOverride: songs.manualOverride,
    });

    const song = updated[0];
    if (!song) throw new HttpError(404, 'No such song');
    res.json({ song });
  }),
);

/**
 * The days ahead: what each will play, and whether that is settled or still a projection.
 *
 * Songs are joined in here rather than returned as bare ids so the page can render a schedule
 * without a second round trip per day.
 */
adminRouter.get(
  '/daily-puzzles/upcoming',
  validate(z.object({ days: z.coerce.number().int().min(1).max(60).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { days = 14 } = req.query as unknown as { days?: number };
    const upcoming = await previewUpcomingPuzzles(days);

    const songIds = [
      ...new Set(upcoming.map((u) => u.songId).filter((id): id is number => id != null)),
    ];
    const songRows = songIds.length
      ? await db
          .select({
            id: songs.id,
            title: songs.title,
            artist: songs.artist,
            albumArtUrl: songs.albumArtUrl,
          })
          .from(songs)
          .where(inArray(songs.id, songIds))
      : [];
    const byId = new Map(songRows.map((row) => [row.id, row]));

    // previewUpcomingPuzzles returns one entry per slot, already in (date, position) order;
    // grouped here so the response is still "one entry per day" the way it was before slots.
    const byDate = new Map<string, { puzzleDate: string; slots: unknown[] }>();
    for (const slot of upcoming) {
      const day = byDate.get(slot.puzzleDate) ?? { puzzleDate: slot.puzzleDate, slots: [] };
      day.slots.push({
        position: slot.position,
        scheduled: slot.scheduled,
        song: slot.songId == null ? null : (byId.get(slot.songId) ?? null),
      });
      byDate.set(slot.puzzleDate, day);
    }

    res.json({ today: getUtcDateString(), days: [...byDate.values()] });
  }),
);

/**
 * Re-rolls one slot onto a different song, chosen at random from the eligible pool.
 *
 * Deliberately excludes whatever the slot currently holds, and whatever the date's other slots
 * hold, so pressing it always visibly does something — a "shuffle" that can hand back a song
 * already sitting elsewhere that same day reads as broken.
 */
adminRouter.post(
  '/daily-puzzles/:date/:position/randomize',
  validate(slotParamsSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { date, position } = req.params as unknown as z.infer<typeof slotParamsSchema>;
    const existing = await assertEditable(date, position);

    const siblingRows = await db
      .select({ songId: dailyPuzzles.songId })
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.puzzleDate, date), ne(dailyPuzzles.position, position)));
    const siblingIds = new Set(siblingRows.map((r) => r.songId));

    const eligible = await db
      .select({ id: songs.id, title: songs.title, artist: songs.artist })
      .from(songs)
      .where(and(eq(songs.active, true), eq(songs.manualOverride, true)));

    const pool =
      eligible.length > 0
        ? eligible
        : await db
            .select({ id: songs.id, title: songs.title, artist: songs.artist })
            .from(songs)
            .where(eq(songs.active, true));

    const candidates = pool.filter(
      (song) => song.id !== existing?.songId && !siblingIds.has(song.id),
    );
    if (candidates.length === 0) {
      throw new HttpError(409, 'There is no other song available to swap in');
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)]!;

    if (existing) {
      await db
        .update(dailyPuzzles)
        .set({ songId: chosen.id })
        .where(eq(dailyPuzzles.id, existing.id));
    } else {
      await db.insert(dailyPuzzles).values({ puzzleDate: date, position, songId: chosen.id });
    }

    res.json({ ok: true, puzzleDate: date, position, song: chosen });
  }),
);

// --- Settings ---------------------------------------------------------------------------

/** Every tunable, with its current value, its default and how to render its control. */
adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await describeSettings() });
  }),
);

const settingsPatchSchema = z.object({
  // `unknown` here on purpose: each value is validated by its own schema in the settings
  // registry, which is the only place that knows what shape a given key takes.
  updates: z
    .array(z.object({ key: z.string().min(1), value: z.unknown() }))
    .min(1)
    .max(SETTING_KEYS.length),
});

adminRouter.patch(
  '/settings',
  validate(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    const { updates } = req.body as z.infer<typeof settingsPatchSchema>;

    try {
      await updateSettings(updates as SettingUpdate[], req.session.userId ?? null);
    } catch (err) {
      if (err instanceof SettingsError) throw new HttpError(400, err.message);
      throw err;
    }

    res.json({ settings: await describeSettings() });
  }),
);

adminRouter.post(
  '/settings/:key/reset',
  validate(z.object({ key: z.string().min(1) }), 'params'),
  asyncHandler(async (req, res) => {
    const { key } = req.params as { key: string };
    try {
      await resetSetting(key as SettingKey);
    } catch (err) {
      if (err instanceof SettingsError) throw new HttpError(404, err.message);
      throw err;
    }
    res.json({ settings: await describeSettings() });
  }),
);

// --- Dashboard --------------------------------------------------------------------------

/**
 * The command-centre view: what the game is made of, what people are doing with it, and how the
 * caches are holding up. One endpoint rather than several so the page renders in one round trip
 * and every number is from the same instant.
 */
adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [content, players, activity, caches, topArtists, topCategories] = await Promise.all([
      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          active: sql<number>`COUNT(*) FILTER (WHERE ${songs.active})::int`,
          curated: sql<number>`COUNT(*) FILTER (WHERE ${songs.active} AND ${songs.manualOverride})::int`,
        })
        .from(songs),

      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          admins: sql<number>`COUNT(*) FILTER (WHERE ${users.isAdmin})::int`,
          newThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${users.createdAt} > now() - interval '7 days')::int`,
          activeThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${users.lastLoginAt} > now() - interval '7 days')::int`,
        })
        .from(users),

      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM game_results WHERE created_at > now() - interval '1 day')::int
            AS "dailyPlays24h",
          (SELECT COUNT(*) FROM game_results WHERE created_at > now() - interval '7 days')::int
            AS "dailyPlays7d",
          (SELECT COUNT(*) FROM artist_session_results r
             JOIN artist_challenges c ON c.id = r.challenge_id
             WHERE r.completed AND c.source_type = 'artist'
               AND r.updated_at > now() - interval '7 days')::int AS "artistRuns7d",
          (SELECT COUNT(*) FROM artist_session_results r
             JOIN artist_challenges c ON c.id = r.challenge_id
             WHERE r.completed AND c.source_type = 'category'
               AND r.updated_at > now() - interval '7 days')::int AS "categoryRuns7d",
          (SELECT COUNT(*) FROM artist_session_results WHERE NOT completed)::int
            AS "runsInProgress"
      `),

      db.execute(sql`
        SELECT
          COUNT(*)::int                                                   AS "pools",
          COALESCE(SUM(track_count), 0)::int                              AS "tracks",
          COUNT(*) FILTER (WHERE deezer_artist_id ~ '^[0-9]+$')::int      AS "artistPools",
          COUNT(*) FILTER (WHERE deezer_artist_id !~ '^[0-9]+$')::int     AS "categoryPools",
          EXTRACT(EPOCH FROM (now() - MIN(last_accessed_at)))::int        AS "oldestIdleSeconds"
        FROM artist_track_pools
      `),

      getMostPlayedArtists(5),
      getMostPlayedCategories(5),
    ]);

    res.json({
      today: getUtcDateString(),
      content: content[0] ?? { total: 0, active: 0, curated: 0 },
      players: players[0] ?? { total: 0, admins: 0, newThisWeek: 0, activeThisWeek: 0 },
      activity: (activity as unknown as Record<string, number>[])[0] ?? {},
      caches: (caches as unknown as Record<string, number>[])[0] ?? {},
      topArtists,
      topCategories,
      liveRooms: activeRoomCount(),
    });
  }),
);

// --- Users -------------------------------------------------------------------------------

const usersQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRouter.get(
  '/users',
  validate(usersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q, limit = 50, offset = 0 } = req.query as unknown as z.infer<typeof usersQuerySchema>;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        rating: users.rating,
        ratedDuels: users.ratedDuels,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(q ? or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const countRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(users)
      .where(q ? or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined);

    res.json({ users: rows, total: countRows[0]?.count ?? 0 });
  }),
);

adminRouter.patch(
  '/users/:userId',
  validate(z.object({ userId: z.string().min(1) }), 'params'),
  validate(
    z.object({
      isAdmin: z.boolean().optional(),
      displayName: z.string().trim().min(1).max(50).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const patch = req.body as { isAdmin?: boolean; displayName?: string };

    if (patch.isAdmin === undefined && patch.displayName === undefined) {
      throw new HttpError(400, 'Nothing to change');
    }

    if (patch.isAdmin === false && userId === req.session.userId) {
      throw new HttpError(409, 'You cannot remove your own admin access');
    }

    const updated = await db.update(users).set(patch).where(eq(users.id, userId)).returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      rating: users.rating,
      ratedDuels: users.ratedDuels,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    });

    const user = updated[0];
    if (!user) throw new HttpError(404, 'No such user');
    res.json({ user });
  }),
);

// --- Multiplayer rooms -------------------------------------------------------------------

adminRouter.get(
  '/rooms',
  asyncHandler(async (_req, res) => {
    res.json({ rooms: listRooms() });
  }),
);

adminRouter.delete(
  '/rooms/:code',
  validate(z.object({ code: z.string().min(1) }), 'params'),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const closed = forceCloseRoom(code);
    if (!closed) throw new HttpError(404, 'No such room');
    res.json({ ok: true });
  }),
);

// --- Activity ----------------------------------------------------------------------------

/**
 * Who played what, and how many people showed up.
 *
 * The dashboard answers "how much is happening" with counters. This answers "what actually
 * happened", which is a different question: a run of completions against one category tells you
 * the category landed, and a stream of abandoned runs against another tells you it did not.
 *
 * Visitors are counted from `sessions`, which is every browser that has been issued a cookie,
 * signed in or not. That is the honest denominator for a game most people try without
 * registering — counting `users` would miss almost everyone.
 */
adminRouter.get(
  '/activity',
  validate(z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { limit = 40 } = req.query as unknown as { limit?: number };

    const [visitors, recent, byCategory] = await Promise.all([
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM sessions)::int AS "sessionsTotal",
          (SELECT COUNT(*) FROM sessions WHERE created_at > now() - interval '1 day')::int
            AS "visitors24h",
          (SELECT COUNT(*) FROM sessions WHERE created_at > now() - interval '7 days')::int
            AS "visitors7d",
          (SELECT COUNT(*) FROM sessions WHERE created_at > now() - interval '30 days')::int
            AS "visitors30d",
          -- Signed-in share of the same window, which is the number that says whether the
          -- account flow is worth anything.
          (SELECT COUNT(*) FROM sessions
             WHERE user_id IS NOT NULL AND created_at > now() - interval '7 days')::int
            AS "signedIn7d"
      `),

      // One row per run, newest first. Guests are reported as guests rather than as a raw id:
      // the id is not useful to a human and is more identifying than the answer needs to be.
      db.execute(sql`
        SELECT
          r.id,
          COALESCE(u.display_name, 'Guest')              AS "player",
          (r.user_id IS NOT NULL)                        AS "isUser",
          c.artist_name                                  AS "source",
          c.source_type                                  AS "sourceType",
          r.songs_correct                                AS "correct",
          c.rounds                                       AS "rounds",
          r.completed                                    AS "completed",
          r.time_taken_seconds                           AS "seconds",
          r.updated_at                                   AS "at"
        FROM artist_session_results r
        JOIN artist_challenges c ON c.id = r.challenge_id
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.updated_at DESC
        LIMIT ${limit}
      `),

      // Completion rate per source over the last week. An abandoned run is the strongest
      // signal a category is too hard, too obscure, or broken.
      db.execute(sql`
        SELECT
          c.artist_name                                            AS "source",
          c.source_type                                            AS "sourceType",
          COUNT(*)::int                                            AS "runs",
          COUNT(*) FILTER (WHERE r.completed)::int                 AS "completed",
          ROUND(AVG(r.songs_correct)::numeric, 1)::float8          AS "avgCorrect"
        FROM artist_session_results r
        JOIN artist_challenges c ON c.id = r.challenge_id
        WHERE r.updated_at > now() - interval '7 days'
        GROUP BY c.artist_name, c.source_type
        ORDER BY COUNT(*) DESC
        LIMIT 20
      `),
    ]);

    // `db.execute` hands back the rows directly here, same as the dashboard above.
    const rows = <T>(result: unknown) => result as T[];

    res.json({
      visitors: rows<Record<string, number>>(visitors)[0] ?? {},
      recent: rows<Record<string, unknown>>(recent),
      byCategory: rows<Record<string, unknown>>(byCategory),
    });
  }),
);

// --- Category and collection pools -------------------------------------------------------
//
// Reads the *stored* pool rather than building one. Listing what a category actually contains
// is a read, and it should stay a read: building Hollywood Films means refetching 902 albums
// from Deezer behind one admin click, on the same rate limit that has already produced a
// silently-truncated pool once. A category nobody has played yet reports itself as not built,
// which is the true answer, and playing it once fills this in.

adminRouter.get(
  '/pools',
  asyncHandler(async (_req, res) => {
    const stored = await db
      .select({
        id: artistTrackPools.deezerArtistId,
        trackCount: artistTrackPools.trackCount,
        fetchedAt: artistTrackPools.fetchedAt,
      })
      .from(artistTrackPools)
      .where(eq(artistTrackPools.includeFeatures, false));

    const byId = new Map(stored.map((row) => [row.id, row]));

    res.json({
      pools: CATEGORIES.map((category) => {
        const row = byId.get(category.id);
        return {
          id: category.id,
          label: category.label,
          group: category.group,
          // The curated title count, which is what the catalogue promises, against the track
          // count actually cached — the gap is how many albums Deezer really gave us.
          titleCount: category.titles?.length ?? null,
          trackCount: row?.trackCount ?? null,
          fetchedAt: row?.fetchedAt ?? null,
        };
      }),
    });
  }),
);

adminRouter.get(
  '/pools/:id',
  validate(z.object({ id: z.string().min(1) }), 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const category = findCategory(id);
    if (!category) throw new HttpError(404, 'No such category');

    const rows = await db
      .select({ tracks: artistTrackPools.tracks, fetchedAt: artistTrackPools.fetchedAt })
      .from(artistTrackPools)
      .where(
        and(eq(artistTrackPools.deezerArtistId, id), eq(artistTrackPools.includeFeatures, false)),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new HttpError(404, 'That pool has not been built yet; play it once first');

    res.json({
      label: category.label,
      // Soundtrack pools put the film in `title` and "song · performer" in `artist`, so the
      // client is told which shape it is rather than having to guess from the text.
      answerIsTitle: isSoundtrackCategory(category),
      fetchedAt: row.fetchedAt,
      tracks: row.tracks.map((t) => ({
        deezerTrackId: t.deezerTrackId,
        title: t.title,
        artist: t.artist,
      })),
    });
  }),
);
