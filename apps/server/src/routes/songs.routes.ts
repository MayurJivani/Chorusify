import { Router } from 'express';
import { z } from 'zod';
import { and, eq, exists, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { dailyPuzzles, songs } from '../db/schema';
import { foldForSearch } from '../utils/songAliases';
import { validate } from '../middleware/validate';
import { searchRateLimiter } from '../middleware/rateLimiters';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { getFreshPreviewUrl } from '../services/deezerService';

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

/** Well-known songs from the bank for the shop window: the landing page's free round and shelf. */
songsRouter.get(
  '/sampler',
  searchRateLimiter,
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        albumArtUrl: songs.albumArtUrl,
        dailyEdition: songs.dailyEdition,
      })
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

const previewSchema = z.object({ id: z.coerce.number().int().positive() });

songsRouter.get(
  '/:id/preview',
  searchRateLimiter,
  validate(previewSchema, 'params'),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof previewSchema>;
    const [song] = await db
      .select({ deezerTrackId: songs.deezerTrackId })
      .from(songs)
      .where(and(eq(songs.id, id), isNotNull(songs.scene)))
      .limit(1);
    if (!song) throw new HttpError(404, 'No such song');
    const fresh = await getFreshPreviewUrl(song.deezerTrackId);
    if (!fresh) throw new HttpError(503, 'That preview is unavailable right now');
    res.json({ previewUrl: fresh.previewUrl });
  }),
);
