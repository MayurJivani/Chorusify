/**
 * Keeps the daily puzzle's song bank in sync with Deezer's "Top Worldwide"
 * chart playlist. The chart provides the songs that are famous right now: a
 * sync upserts every track from it (marked active) and deactivates songs that
 * are no longer on it. Songs flagged `manual_override` are pinned — the sync
 * never deactivates them and never force-reactivates them — so a hand-curated
 * all-time list can coexist with the live chart.
 */
import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { dailyPuzzles, songs } from '../db/schema';
import { logger } from '../logger';
import { deezerFetchJson } from './deezerService';

interface DailyPlaylist {
  id: string;
  label: string;
}

/**
 * The playlists that define the song bank. Only the current worldwide chart
 * (Deezer Charts "Top Worldwide", a top-100 list updated in real time) is used,
 * so the pool is inherently famous and re-curated with every sync.
 */
export const DAILY_PLAYLISTS: DailyPlaylist[] = [{ id: '3155776842', label: 'Top Worldwide' }];

interface PlaylistTrack {
  deezerTrackId: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  durationSeconds: number;
  previewUrl: string;
}

interface DeezerPlaylistTrack {
  id?: number;
  title?: string;
  duration?: number;
  preview?: string;
  artist?: { name?: string };
  album?: { cover_medium?: string };
}

interface DeezerTrackListResponse {
  data?: DeezerPlaylistTrack[];
  next?: string;
  error?: unknown;
}

/**
 * Fetches every track of a playlist, following Deezer's `next` pagination. Any
 * page failure throws so a truncated playlist is never treated as complete
 * (which would otherwise wrongly deactivate songs during the sync).
 */
export async function fetchPlaylistTracks(playlistId: string): Promise<PlaylistTrack[]> {
  const tracks: PlaylistTrack[] = [];
  let url: string | null = `https://api.deezer.com/playlist/${playlistId}/tracks?limit=100`;

  while (url) {
    const body: DeezerTrackListResponse | null = await deezerFetchJson(url, 'bulk');
    if (!body) throw new Error(`Deezer playlist ${playlistId} fetch failed`);
    if (body.error) {
      throw new Error(`Deezer playlist ${playlistId} returned an error`);
    }

    for (const t of body.data ?? []) {
      // Tracks without a preview cannot be played, so they never enter the bank.
      if (!t.id || !t.title || !t.preview) continue;
      tracks.push({
        deezerTrackId: String(t.id),
        title: t.title,
        artist: t.artist?.name ?? 'Unknown',
        albumArtUrl: t.album?.cover_medium ?? null,
        durationSeconds: t.duration ?? 0,
        previewUrl: t.preview,
      });
    }
    url = body.next ?? null;
  }

  return tracks;
}

const PLAYLIST_FETCH_CONCURRENCY = 3;
const BATCH_SIZE = 200;

export interface SyncSummary {
  totalTracks: number;
  deactivated: number;
  failedPlaylists: number;
}

/**
 * Rebuilds the song bank from the configured playlists. Tracks present in any
 * playlist are upserted (keyed by deezer_track_id) as active with a fresh
 * verified_at; active songs absent from every playlist are deactivated — but
 * only when every playlist fetched successfully, so a transient API failure
 * never wipes the pool.
 */
export async function syncDailyPlaylists(): Promise<SyncSummary> {
  const allTracks: PlaylistTrack[] = [];
  let failedPlaylists = 0;

  for (let i = 0; i < DAILY_PLAYLISTS.length; i += PLAYLIST_FETCH_CONCURRENCY) {
    const batch = DAILY_PLAYLISTS.slice(i, i + PLAYLIST_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((p) => fetchPlaylistTracks(p.id)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTracks.push(...result.value);
      } else {
        failedPlaylists += 1;
        logger.warn({ err: result.reason }, 'Playlist fetch failed; skipping playlist');
      }
    }
  }

  // The same song can appear in several year playlists — keep one row per track.
  const deduped = new Map<string, PlaylistTrack>();
  for (const track of allTracks) {
    if (!deduped.has(track.deezerTrackId)) deduped.set(track.deezerTrackId, track);
  }
  const tracks = [...deduped.values()];

  const now = new Date();
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const chunk = tracks.slice(i, i + BATCH_SIZE);
    await db
      .insert(songs)
      .values(
        chunk.map((t) => ({
          title: t.title,
          artist: t.artist,
          deezerTrackId: t.deezerTrackId,
          previewUrl: t.previewUrl,
          albumArtUrl: t.albumArtUrl,
          durationSeconds: t.durationSeconds,
          active: true,
          verifiedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: songs.deezerTrackId,
        set: {
          title: sql`excluded.${sql.raw('title')}`,
          artist: sql`excluded.${sql.raw('artist')}`,
          previewUrl: sql`excluded.${sql.raw('preview_url')}`,
          albumArtUrl: sql`excluded.${sql.raw('album_art_url')}`,
          durationSeconds: sql`excluded.${sql.raw('duration_seconds')}`,
          active: sql`CASE WHEN ${songs.manualOverride} THEN ${songs.active} ELSE true END`,
          verifiedAt: now,
        },
      });
  }

  let deactivated = 0;
  if (failedPlaylists === 0) {
    const fetchedIds = new Set(tracks.map((t) => t.deezerTrackId));
    const activeRows = await db
      .select({ deezerTrackId: songs.deezerTrackId })
      .from(songs)
      .where(
        and(
          eq(songs.active, true),
          eq(songs.manualOverride, false),
          // Never deactivate a song that has been used as a daily answer. Doing so took the
          // song out of the guess autocomplete, which made that day's puzzle unwinnable — the
          // one word a player needed to type was the one the search would not return.
          notExists(
            db
              .select({ one: sql`1` })
              .from(dailyPuzzles)
              .where(eq(dailyPuzzles.songId, songs.id)),
          ),
        ),
      );
    const staleIds = activeRows.map((r) => r.deezerTrackId).filter((id) => !fetchedIds.has(id));

    for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
      const chunk = staleIds.slice(i, i + BATCH_SIZE);
      await db
        .update(songs)
        .set({ active: false })
        .where(and(eq(songs.active, true), inArray(songs.deezerTrackId, chunk)));
      deactivated += chunk.length;
    }
  }

  logger.info(
    { totalTracks: tracks.length, deactivated, failedPlaylists },
    'Daily playlist sync complete',
  );

  return { totalTracks: tracks.length, deactivated, failedPlaylists };
}

const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
let lastSyncAttemptAt = 0;
let syncInFlight: Promise<void> | null = null;

/**
 * Keeps the song bank fresh without ever making a player wait for it.
 *
 * The sync crawls a Deezer playlist and upserts a few thousand rows, which takes seconds. It
 * used to be awaited inside `GET /api/puzzle/today`, so whichever unlucky player arrived once
 * the bank went stale paid that cost before seeing their puzzle — and because the "attempted"
 * marker was only written after the sync finished, every request arriving in the meantime
 * started a redundant sync of its own.
 *
 * Now the staleness marker is set up front and the sync runs detached: the caller returns
 * immediately and today's puzzle is served from the bank as it currently stands, with the
 * refreshed bank landing in time for subsequent requests. `awaitCompletion` is for startup and
 * tests, where blocking is the point. A no-op under NODE_ENV=test.
 */
export async function ensureDailyPlaylistsFresh(awaitCompletion = false): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  if (syncInFlight) {
    if (awaitCompletion) await syncInFlight;
    return;
  }

  const now = Date.now();
  if (lastSyncAttemptAt && now - lastSyncAttemptAt < FRESH_WINDOW_MS) return;

  const rows = await db
    .select({ verifiedAt: songs.verifiedAt })
    .from(songs)
    .where(eq(songs.active, true))
    .orderBy(desc(songs.verifiedAt))
    .limit(1);
  const lastVerifiedAt = rows[0]?.verifiedAt?.getTime() ?? 0;

  if (lastVerifiedAt && now - lastVerifiedAt < FRESH_WINDOW_MS) {
    lastSyncAttemptAt = now;
    return;
  }

  // Claim the window before starting so concurrent callers short-circuit above rather than
  // each kicking off their own crawl.
  lastSyncAttemptAt = now;
  syncInFlight = syncDailyPlaylists()
    .then(() => undefined)
    .catch((err) => {
      logger.error({ err }, 'Daily playlist sync failed');
    })
    .finally(() => {
      syncInFlight = null;
    });

  if (awaitCompletion) await syncInFlight;
}
