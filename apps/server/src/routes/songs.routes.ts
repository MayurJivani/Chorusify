import { Router } from 'express';
import { z } from 'zod';
import { and, eq, exists, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { dailyPuzzles, songs } from '../db/schema';
import { foldForSearch } from '../utils/songAliases';
import { getSettings } from '../services/settingsService';
import { validate } from '../middleware/validate';
import { searchRateLimiter } from '../middleware/rateLimiters';
import { asyncHandler } from '../middleware/asyncHandler';

export const songsRouter = Router();

const searchSchema = z.object({
  q: z.string().trim().min(1).max(80),
});

songsRouter.get(
  '/search',
  searchRateLimiter,
  validate(searchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q } = req.query as unknown as z.infer<typeof searchSchema>;

    // Guess autocomplete across title/artist: prefix ILIKE matches first, with a Postgres
    // full-text fallback (websearch_to_tsquery tolerates arbitrary user input) so a search
    // like "michael jackson" still finds an entry whose title doesn't start with the query.
    const prefix = `${q}%`;

    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        albumArtUrl: songs.albumArtUrl,
      })
      .from(songs)
      .where(
        and(
          // Active songs, *plus* any song that is the answer to a daily puzzle. The chart sync
          // deactivates songs that drop off the chart, and it will happily do that to a song
          // already chosen as a past or present answer — at which point the autocomplete could
          // no longer offer it and the puzzle became literally unguessable. Answers stay
          // searchable regardless of whether they are still in the active pool.
          or(
            eq(songs.active, true),
            exists(
              db
                .select({ one: sql`1` })
                .from(dailyPuzzles)
                .where(eq(dailyPuzzles.songId, songs.id)),
            ),
          ),
          or(
            sql`${songs.title} ILIKE ${prefix}`,
            sql`${songs.artist} ILIKE ${prefix}`,
            sql`to_tsvector('english', ${songs.title} || ' ' || ${songs.artist}) @@ websearch_to_tsquery('english', ${q})`,
            // Alternative spellings: "kabhi kabhi" finds "Kabhie Kabhie".
            sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${songs.aliases}) a WHERE a LIKE ${`${foldForSearch(q)}%`})`,
          ),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${songs.title} ILIKE ${prefix} OR ${songs.artist} ILIKE ${prefix} THEN 0 ELSE 1 END`,
        songs.title,
      )
      .limit(8);

    res.json({ results: rows });
  }),
);

/** Covers for the home page wall: the admin's picks in their order, or well-known songs at random. */
songsRouter.get(
  '/sampler',
  searchRateLimiter,
  asyncHandler(async (_req, res) => {
    const columns = {
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      albumArtUrl: songs.albumArtUrl,
      dailyEdition: songs.dailyEdition,
    };
    const { homeWallSongIds: chosen } = await getSettings();
    const rows =
      chosen.length > 0
        ? await db
            .select(columns)
            .from(songs)
            .where(and(inArray(songs.id, chosen), isNotNull(songs.albumArtUrl)))
            .orderBy(
              sql`array_position(${sql.raw(`ARRAY[${chosen.join(',')}]::int[]`)}, ${songs.id})`,
            )
        : await db
            .select(columns)
            .from(songs)
            .where(
              and(
                eq(songs.active, true),
                isNotNull(songs.dailyEdition),
                isNotNull(songs.albumArtUrl),
                lte(songs.difficulty, 2),
              ),
            )
            .orderBy(sql`random()`)
            .limit(72);
    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs)
      .where(and(eq(songs.active, true), isNotNull(songs.scene)));
    res.json({ songs: rows, total: total?.count ?? 0 });
  }),
);
