/**
 * Turns a category into a playable track pool, cached exactly like an artist's catalog.
 *
 * Reuses `artist_track_pools` rather than adding a parallel table: the row is keyed by an
 * opaque text id, and a category slug ("year-2024") can never collide with a numeric Deezer
 * artist id. That also means categories inherit the eviction sweep and the stale-while-
 * revalidate refresh for free.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { artistTrackPools } from '../db/schema';
import { fetchPlaylistTracks } from './dailyPlaylistService';
import { seedPreviewCacheFromPlaylist, type ArtistTrack } from './deezerService';
import {
  isUnwantedVersion,
  normalizeTitle,
  stripAnyTrailingQualifier,
} from '../utils/trackFilters';
import { findCategory } from './categories';
import { getSoundtrackCatalog } from './soundtrackCatalogService';
import { getSettings } from './settingsService';
import { logger } from '../logger';

/**
 * How stale a stored category pool may get before it is refreshed in the background.
 *
 * A category is a fixed editorial playlist, so it changes far more slowly than an artist's
 * discography — except the live worldwide chart, which is why the default is only a day. Admin
 * configurable, since how fresh "top right now" needs to be is a judgement call.
 */
async function refreshAfterMs(): Promise<number> {
  return (await getSettings()).categoryPoolRefreshHours * 60 * 60 * 1000;
}

/** Ten rounds need at least ten tracks; below this the category is unplayable. */
const MIN_CATEGORY_TRACKS = 10;

/**
 * Deduplicates a playlist down to one entry per song.
 *
 * The feature filter is deliberately *not* applied here, unlike an artist catalog. There it
 * exists to drop tracks where the searched artist is only a guest; in a category every track
 * is by a different artist, so filtering on "feat." would throw away a large share of modern
 * pop for no reason.
 */
function buildCategoryPool(
  tracks: {
    deezerTrackId: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
    durationSeconds: number;
  }[],
): ArtistTrack[] {
  const eligible = tracks.filter((t) => !isUnwantedVersion(t.title));

  const bestByKey = new Map<string, ArtistTrack>();
  for (const t of eligible) {
    // Keyed on artist *and* title: two different artists can legitimately have songs of the
    // same name, and a category spans many artists.
    const key = `${normalizeTitle(t.artist)}|${normalizeTitle(stripAnyTrailingQualifier(t.title))}`;
    if (!bestByKey.has(key)) bestByKey.set(key, t);
  }

  // Sorted so `seededShuffle` gets a reproducible input, same as the artist catalog.
  return [...bestByKey.values()].sort((a, b) => a.deezerTrackId.localeCompare(b.deezerTrackId));
}

async function fetchMultiplePlaylists(
  playlistIds: string[],
): Promise<Parameters<typeof buildCategoryPool>[0]> {
  const results = await Promise.all(playlistIds.map((id) => fetchPlaylistTracks(id)));
  const flat = results.flat();
  seedPreviewCacheFromPlaylist(flat);
  return flat;
}

async function readPool(categoryId: string) {
  const rows = await db
    .select()
    .from(artistTrackPools)
    .where(
      and(
        eq(artistTrackPools.deezerArtistId, categoryId),
        eq(artistTrackPools.includeFeatures, false),
      ),
    )
    .limit(1);
  return rows[0];
}

async function writePool(categoryId: string, label: string, tracks: ArtistTrack[]): Promise<void> {
  const now = new Date();
  await db
    .insert(artistTrackPools)
    .values({
      deezerArtistId: categoryId,
      includeFeatures: false,
      artistName: label,
      tracks,
      trackCount: tracks.length,
      fetchedAt: now,
      lastAccessedAt: now,
    })
    .onConflictDoUpdate({
      target: [artistTrackPools.deezerArtistId, artistTrackPools.includeFeatures],
      set: {
        artistName: label,
        tracks,
        trackCount: tracks.length,
        fetchedAt: now,
        lastAccessedAt: now,
      },
    });
}

/**
 * The category's playable tracks. Served from the stored pool when one exists, refreshing in
 * the background once it is a day old, otherwise fetched from the backing playlist.
 */
export async function getCategoryCatalog(categoryId: string): Promise<ArtistTrack[]> {
  const category = findCategory(categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);

  // Movie collections are categories in every respect except where their tracks come from.
  if (category.titles?.length) {
    return getSoundtrackCatalog(
      category.id,
      category.label,
      category.titles,
      category.soundtrackKind,
    );
  }

  let stored;
  try {
    stored = await readPool(categoryId);
  } catch (err) {
    logger.warn({ err, categoryId }, 'Category pool lookup failed; fetching live');
  }

  if (stored && stored.trackCount >= MIN_CATEGORY_TRACKS) {
    if (Date.now() - stored.fetchedAt.getTime() > (await refreshAfterMs())) {
      void refreshInBackground(category.id, category.label, category.playlistIds);
    }
    await warmPreviews(category.id, category.playlistIds);
    return stored.tracks;
  }

  const allRaw = await fetchMultiplePlaylists(category.playlistIds);
  const tracks = buildCategoryPool(allRaw);
  if (tracks.length < MIN_CATEGORY_TRACKS) {
    throw new Error(`Not enough playable tracks in ${category.label}`);
  }

  try {
    await writePool(category.id, category.label, tracks);
  } catch (err) {
    logger.warn({ err, categoryId }, 'Failed to store category pool');
  }
  return tracks;
}

const refreshing = new Set<string>();

/**
 * A stored pool carries no usable preview URLs (Deezer signs them for about fifteen minutes), so a
 * game over it looked each song up: a call per candidate, two candidates per round, all through one
 * budget of nine calls a second. With a thousand players starting at once the last rooms waited over
 * a minute (scripts/loadtest-rooms.ts). The category's playlists return every preview in a call or
 * two and seed the cache those lookups read, so each category costs a few calls per few minutes
 * however many rooms play it. Songs that have since left the playlists still get looked up singly.
 */
const WARM_MS = 8 * 60 * 1000; // inside the preview cache's ten minutes
const warmed = new Map<string, { until: number; done: Promise<void> }>();

function warmPreviews(categoryId: string, playlistIds: string[]): Promise<void> {
  const hit = warmed.get(categoryId);
  if (hit && hit.until > Date.now()) return hit.done;
  const done = fetchMultiplePlaylists(playlistIds).then(
    () => undefined,
    (err) => {
      // Not fatal: the game falls back to looking each song up, as before.
      logger.warn({ err, categoryId }, 'Preview warm-up failed');
      warmed.delete(categoryId);
    },
  );
  warmed.set(categoryId, { until: Date.now() + WARM_MS, done });
  return done;
}

function refreshInBackground(categoryId: string, label: string, playlistIds: string[]): void {
  if (refreshing.has(categoryId)) return;
  refreshing.add(categoryId);

  void fetchMultiplePlaylists(playlistIds)
    .then(async (raw) => {
      const tracks = buildCategoryPool(raw);
      if (tracks.length < MIN_CATEGORY_TRACKS) return;
      await writePool(categoryId, label, tracks);
      logger.info({ categoryId, trackCount: tracks.length }, 'Refreshed category pool');
    })
    .catch((err) => logger.warn({ err, categoryId }, 'Category pool refresh failed'))
    .finally(() => refreshing.delete(categoryId));
}
