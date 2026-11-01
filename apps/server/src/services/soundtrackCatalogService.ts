/**
 * Turns a set of curated soundtrack albums into a playable pool where the *film* is the answer.
 *
 * The trick that lets this mode reuse every other mode's machinery is the shape of the rows it
 * produces: `title` holds the film, so the existing round builder, option builder, guess check,
 * scoring, multiplayer rooms and duels all work untouched. `artist` carries the song and its
 * performer, which is what the reveal shows once the round is over.
 *
 * That field placement is load-bearing in one direction: options must never display `artist`,
 * because it names the song currently playing. A player who recognises the track by ear would
 * otherwise read the answer straight off the option list instead of knowing the film, which is
 * the entire thing being tested. `buildRoundOptions` is called with `hideArtist` for these
 * sources; see `ChallengeSource.answerIsTitle`.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { artistTrackPools } from '../db/schema';
import { deezerFetchJson, seedPreviewCacheFromPlaylist, type ArtistTrack } from './deezerService';
import { isUnwantedVersion, normalizeTitle } from '../utils/trackFilters';
import type { SoundtrackTitle, SoundtrackKind } from './soundtracks';
import { getSettings } from './settingsService';
import { logger } from '../logger';

/** Four options need four distinct films, and a pool that thin makes for repetitive rounds. */
const MIN_MOVIE_TRACKS = 12;

/**
 * Titles that are on a soundtrack without being a song anyone could name the film from.
 *
 * `isUnwantedVersion` already drops karaoke, instrumentals and commentary, but soundtrack albums
 * carry two extra kinds of filler it has no reason to know about: score cues named after scenes
 * ("Elephant Graveyard", "Scar Takes the Throne") and recorded dialogue. Cues are not detectable
 * from the title alone, which is why albums are hand-picked to be song-led in the first place;
 * these terms catch the labelled remainder.
 *
 * Deliberately narrow. "Theme" is not here — "Theme from Shaft" and "Love Theme From Flashdance"
 * are real, recognisable songs, and excluding the word would cost more than it saves.
 */
const NON_SONG_TERMS = [
  'dialogue',
  'dialogues',
  'outtake',
  'overture',
  'prologue',
  'epilogue',
  'end credits',
  'opening titles',
  'main titles',
  'title music',
  'score',
  'sing a long',
  'singalong',
  'sing along',
];

/**
 * The only filler worth removing from a score album.
 *
 * Applying the full list above to a score collection would delete its best rounds: "Main Title"
 * on the Star Wars album is the Star Wars theme, "Opening Titles" on Jurassic Park is the
 * Jurassic Park theme, and the Grand Budapest and Requiem albums both open on an "Overture"
 * that is the piece everyone knows. What genuinely cannot be guessed is recorded speech —
 * Avatar's album opens with a line of Jake's narration.
 */
const NON_SCORE_TERMS = ['dialogue', 'dialogues', 'outtake', 'commentary'];

function matchesAny(title: string, terms: string[]): boolean {
  const normalized = normalizeTitle(title);
  return terms.some((term) => new RegExp(`\\b${normalizeTitle(term)}\\b`).test(normalized));
}

function isNonSong(title: string, kind: SoundtrackKind = 'songs'): boolean {
  return matchesAny(title, kind === 'score' ? NON_SCORE_TERMS : NON_SONG_TERMS);
}

interface DeezerAlbumTrack {
  id: number;
  title: string;
  preview?: string | null;
  duration?: number;
  artist?: { name?: string };
  /** Deezer's play-count rank. Only meaningful relative to its own album. */
  rank?: number;
}

/**
 * Keeps the better-known half of an album when the admin has asked for it.
 *
 * A soundtrack is mostly filler. Of forty cues on a score album perhaps six are ones anyone
 * could name, and a round drawn from the other thirty-four is unanswerable rather than hard.
 * Rank is a play count, so it says exactly which those are.
 *
 * Relative rather than a fixed cutoff: a Bollywood hit and an obscure indie score sit in
 * completely different rank ranges, and any absolute threshold would empty one and pass the
 * whole of the other. The top half of each album applies the same judgement evenly.
 *
 * Never cuts below four, because a film with nothing left is worse than one with a couple of
 * quiet songs in it.
 */
const POPULAR_FRACTION = 0.5;
const MIN_KEPT_PER_ALBUM = 4;

function keepPopular(tracks: ArtistTrack[], ranks: Map<string, number>): ArtistTrack[] {
  if (tracks.length <= MIN_KEPT_PER_ALBUM) return tracks;
  const keep = Math.max(MIN_KEPT_PER_ALBUM, Math.ceil(tracks.length * POPULAR_FRACTION));
  return [...tracks]
    .sort((a, b) => (ranks.get(b.deezerTrackId) ?? 0) - (ranks.get(a.deezerTrackId) ?? 0))
    .slice(0, keep);
}

interface DeezerAlbumResponse {
  title?: string;
  cover_medium?: string | null;
  error?: unknown;
  tracks?: { data?: DeezerAlbumTrack[] };
}

/**
 * One request per film. `/album/{id}` returns the cover and the full track list together, so a
 * fifty-film collection costs fifty calls on a cold pool and nothing afterwards — the result is
 * stored and refreshed on the same schedule as a category.
 */
interface FetchedAlbum {
  tracks: ArtistTrack[];
  /** Preview URLs come back with the album, so the per-track lookup can be skipped entirely. */
  seeds: { deezerTrackId: string; previewUrl: string; durationSeconds: number; artist: string }[];
}

/**
 * Deezer answers a quota breach with HTTP 200 and an error body rather than a 429, so the only
 * way to tell "this album does not exist" from "you are going too fast" is to retry and see.
 */
async function fetchAlbumBody(album: SoundtrackTitle): Promise<DeezerAlbumResponse> {
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = await deezerFetchJson<DeezerAlbumResponse>(
      `https://api.deezer.com/album/${album.albumId}`,
      'bulk',
    );
    if (body && !body.error) return body;
    lastError = body ? JSON.stringify(body.error) : 'request failed';
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw new Error(`Deezer album ${album.albumId} (${album.movie}) failed: ${lastError}`);
}

async function fetchSoundtrackTitle(
  album: SoundtrackTitle,
  kind: SoundtrackKind,
  popularOnly: boolean,
): Promise<FetchedAlbum> {
  const body = await fetchAlbumBody(album);

  const cover = body.cover_medium ?? null;
  const out: FetchedAlbum = { tracks: [], seeds: [] };
  const ranks = new Map<string, number>();
  for (const track of body.tracks?.data ?? []) {
    if (!track.id || !track.title || !track.preview) continue;
    if (isUnwantedVersion(track.title) || isNonSong(track.title, kind)) continue;
    const deezerTrackId = String(track.id);
    const songLabel = track.artist?.name ? `${track.title} · ${track.artist.name}` : track.title;
    const durationSeconds = track.duration ?? 0;
    ranks.set(deezerTrackId, track.rank ?? 0);
    out.tracks.push({
      deezerTrackId,
      // The film is the answer, so it goes in the field every existing round path treats as one.
      title: album.movie,
      artist: songLabel,
      albumArtUrl: cover,
      durationSeconds,
    });
    out.seeds.push({
      deezerTrackId,
      previewUrl: track.preview,
      durationSeconds,
      artist: songLabel,
    });
  }
  if (popularOnly) out.tracks = keepPopular(out.tracks, ranks);
  return out;
}

/**
 * Deduped down to one row per song. Keyed on film *and* song title because the pool's `title`
 * is the film — keying on title alone would collapse every album to a single track.
 */
function buildSoundtrackPool(rows: ArtistTrack[]): ArtistTrack[] {
  const bestByKey = new Map<string, ArtistTrack>();
  for (const row of rows) {
    const key = `${normalizeTitle(row.title)}|${normalizeTitle(row.artist)}`;
    if (!bestByKey.has(key)) bestByKey.set(key, row);
  }
  // Sorted so `seededShuffle` downstream gets a reproducible input, same as the other pools.
  return [...bestByKey.values()].sort((a, b) => a.deezerTrackId.localeCompare(b.deezerTrackId));
}

/**
 * Deezer allows roughly 50 requests per 5 seconds per IP. The mixed collection is 69 albums, so
 * firing them all at once puts the tail of the list over the limit — which cost 15 films on the
 * first real build, every one of them logged as a warning and then silently absent from the
 * pool. Matches the concurrency the playlist sync already uses.
 */
const ALBUM_FETCH_CONCURRENCY = 4;

interface FetchOutcome {
  tracks: ArtistTrack[];
  /** Films whose album could not be fetched even after retries. */
  failed: string[];
}

async function fetchAllAlbums(
  albums: SoundtrackTitle[],
  kind: SoundtrackKind,
  popularOnly: boolean,
): Promise<FetchOutcome> {
  const tracks: ArtistTrack[] = [];
  const seeds: FetchedAlbum['seeds'] = [];
  const failed: string[] = [];

  for (let i = 0; i < albums.length; i += ALBUM_FETCH_CONCURRENCY) {
    const batch = albums.slice(i, i + ALBUM_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((album) => fetchSoundtrackTitle(album, kind, popularOnly)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        tracks.push(...result.value.tracks);
        seeds.push(...result.value.seeds);
      } else {
        const movie = batch[index]?.movie ?? 'unknown';
        failed.push(movie);
        logger.warn({ err: result.reason, movie }, 'Movie album fetch failed');
      }
    }
  }

  seedPreviewCacheFromPlaylist(seeds);
  return { tracks, failed };
}

/**
 * How much of a collection may be missing before the result is treated as a bad fetch rather
 * than a smaller catalogue.
 *
 * A film that fails is not a visible error — it just never comes up as an answer — so a
 * throttled build looks exactly like a working one. Storing that partial pool is the expensive
 * mistake, because the cache then serves it for the whole refresh window. Refetching next
 * request is much cheaper than a collection that quietly lost a fifth of its films.
 */
const MAX_FAILED_FRACTION = 0.1;

function isTooIncomplete(failedCount: number, total: number): boolean {
  return failedCount > Math.max(1, Math.floor(total * MAX_FAILED_FRACTION));
}

async function readPool(collectionId: string) {
  const rows = await db
    .select()
    .from(artistTrackPools)
    .where(
      and(
        eq(artistTrackPools.deezerArtistId, collectionId),
        eq(artistTrackPools.includeFeatures, false),
      ),
    )
    .limit(1);
  return rows[0];
}

async function writePool(collectionId: string, label: string, tracks: ArtistTrack[]) {
  const now = new Date();
  await db
    .insert(artistTrackPools)
    .values({
      deezerArtistId: collectionId,
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

const refreshing = new Set<string>();

function refreshInBackground(
  collectionId: string,
  label: string,
  albums: SoundtrackTitle[],
  kind: SoundtrackKind,
  popularOnly: boolean,
): void {
  if (refreshing.has(collectionId)) return;
  refreshing.add(collectionId);

  void fetchAllAlbums(albums, kind, popularOnly)
    .then(async ({ tracks: raw, failed }) => {
      // Never overwrite a good stored pool with a throttled one.
      if (isTooIncomplete(failed.length, albums.length)) {
        logger.warn({ collectionId, failed }, 'Movie pool refresh incomplete; keeping stored pool');
        return;
      }
      const tracks = buildSoundtrackPool(raw);
      if (tracks.length < MIN_MOVIE_TRACKS) return;
      await writePool(collectionId, label, tracks);
      logger.info({ collectionId, trackCount: tracks.length }, 'Refreshed movie pool');
    })
    .catch((err) => logger.warn({ err, collectionId }, 'Movie pool refresh failed'))
    .finally(() => refreshing.delete(collectionId));
}

/**
 * The collection's playable tracks, cached in `artist_track_pools` exactly like a category —
 * the row is keyed by an opaque text id, so a collection slug cannot collide with a numeric
 * Deezer artist id or a category slug.
 */
export async function getSoundtrackCatalog(
  collectionId: string,
  label: string,
  albums: SoundtrackTitle[],
  kind: SoundtrackKind = 'songs',
): Promise<ArtistTrack[]> {
  // Read once per build rather than per album, so a mid-fetch admin change cannot produce a
  // pool that is half filtered and half not.
  const popularOnly = (await getSettings()).soundtrackPopularOnly;
  let stored;
  try {
    stored = await readPool(collectionId);
  } catch (err) {
    logger.warn({ err, collectionId }, 'Movie pool lookup failed; fetching live');
  }

  if (stored && stored.trackCount >= MIN_MOVIE_TRACKS) {
    const refreshAfterMs = (await getSettings()).categoryPoolRefreshHours * 60 * 60 * 1000;
    if (Date.now() - stored.fetchedAt.getTime() > refreshAfterMs) {
      void refreshInBackground(collectionId, label, albums, kind, popularOnly);
    }
    return stored.tracks;
  }

  const { tracks: raw, failed } = await fetchAllAlbums(albums, kind, popularOnly);
  const tracks = buildSoundtrackPool(raw);
  if (tracks.length < MIN_MOVIE_TRACKS) {
    throw new Error(`Not enough playable tracks in ${label}`);
  }

  /*
   * A partial fetch is served but not stored. Missing films are invisible in play — they simply
   * never come up — so caching a throttled build would hide the problem for the whole refresh
   * window. Playing on a short pool now and rebuilding next request is the better trade.
   */
  if (isTooIncomplete(failed.length, albums.length)) {
    logger.warn({ collectionId, failed }, 'Movie pool incomplete; serving without storing');
    return tracks;
  }

  try {
    await writePool(collectionId, label, tracks);
  } catch (err) {
    logger.warn({ err, collectionId }, 'Failed to store movie pool');
  }
  return tracks;
}

export const __testing = { buildSoundtrackPool, isNonSong, isTooIncomplete, keepPopular };
